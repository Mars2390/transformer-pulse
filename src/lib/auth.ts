import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import {
  SESSION_COOKIE,
  roleHome,
  verifySessionToken,
  type SessionUser,
} from "./session";
import { isBlocked } from "./security/blocklist";
import { assertSameOriginFromHeaders } from "./security/csrf";
import { logSecurityEvent } from "./security/events";
import { checkRateLimit, RATE_LIMITS } from "./security/rate-limit";
import { clientIpFromHeaders } from "./security/request";

/**
 * Server-side auth helpers.
 *
 * `server-only` at the top is a guard rail: if anyone ever imports this file
 * into a client component, the build fails loudly instead of shipping bcrypt
 * and our auth logic to the browser.
 */

const BCRYPT_ROUNDS = 12;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/**
 * Burns roughly the same time as a real bcrypt comparison.
 *
 * Without this, "no such email" returns in 1ms while "wrong PIN" takes ~200ms —
 * and that timing difference tells an attacker which KPLC email addresses are
 * real accounts. We show one error message for both cases; this makes the
 * timing match the message.
 */
const DUMMY_HASH = "$2b$12$abcdefghijklmnopqrstuuMFqDMDMxOZ0BKcQ8h5xLcFDBUEXVGy";

export async function burnTime(): Promise<void> {
  await bcrypt.compare("000000", DUMMY_HASH);
}

// Six digits is one million combinations. A script clears that in hours without
// these two numbers.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/**
 * Reads the session from cookies, and checks it is still alive.
 *
 * The signature check alone says the token was issued by us and has not
 * expired. It cannot say the session was revoked, that the user has been idle
 * past the timeout, or that they were signed out by the concurrent-session
 * cap — those are facts about the world after the token was minted, and the
 * token cannot know them. touchSession() answers all three and slides the
 * activity clock forward.
 *
 * Tokens minted before sessions existed carry no sid claim and are accepted
 * until they expire, so deploying this does not sign out everybody mid-shift.
 */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const user = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!user) return null;

  if (user.sessionId) {
    const { touchSession } = await import("./security/sessions");
    const check = await touchSession(user.sessionId);
    if (!check.valid) return null;
  }

  return user;
}

/**
 * For pages: returns the user, or sends them to the login page.
 *
 * THE WHITE SCREEN.
 *
 * getSession() answers no in two very different situations, and until now both
 * redirected to the same place. A visitor with no cookie at all needs the login
 * form. A visitor whose cookie STILL VERIFIES but whose UserSession row is gone —
 * idle past thirty minutes, revoked by the three-session cap when they signed in
 * somewhere else, or ended by a PIN change — needs the login form AND needs that
 * dead cookie taken off them.
 *
 * Sending the second case to a bare /login produced an infinite redirect, because
 * middleware verifies the token and nothing else: the token verified, so
 * middleware bounced them to their dashboard, the dashboard called this function,
 * this function sent them back to /login, and round it went until the browser gave
 * up and painted nothing. That is the white screen, and note what it is NOT — it
 * is not the rate limiter, which returns a red "too many requests" message the
 * login form displays perfectly well.
 *
 * So the two cases are now told apart by whether a cookie was presented at all,
 * and the stale case is marked with ?expired=1. Middleware reads that marker,
 * stops redirecting, and clears the cookie. The loop cannot form.
 */
export async function requireUser(): Promise<SessionUser> {
  const store = await cookies();
  const hadToken = Boolean(store.get(SESSION_COOKIE)?.value);
  const user = await getSession();
  if (!user) redirect(hadToken ? "/login?expired=1" : "/login");
  return user;
}

/**
 * For pages: returns the user if their role is allowed, otherwise sends them to
 * their own dashboard rather than showing a dead end.
 */
export async function requireRole(...allowed: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) redirect(roleHome(user.role));
  return user;
}

/** For API routes: throws instead of redirecting. */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * A 429 needs its own error type: AuthError is typed 401 | 403, and a throttled
 * caller needs the status and the Retry-After that tells it when to come back.
 */
export class TooManyRequestsError extends Error {
  public readonly status = 429 as const;
  constructor(public readonly retryAfterSeconds: number) {
    super("Too many requests. Wait a moment and try again.");
    this.name = "TooManyRequestsError";
  }
}

/**
 * The perimeter, applied where every API route already has to come.
 *
 * guard() cannot be hoisted into middleware — Edge has no database — and
 * wiring it into fifty route files by hand protects fifty routes and no more:
 * the fifty-first is written next week without it. requireApiUser() is the one
 * call an authenticated route cannot skip, because it is how the route learns
 * who is asking. Putting the checks here means a route cannot be written
 * unprotected, which is a stronger guarantee than any review checklist.
 *
 * Body inspection stays in guard() on the routes that opt in. It is deliberately
 * not here: detect.ts is explicit that the payload filter is a probe log, not a
 * control, and reading the body here would consume the stream the route needs.
 */
async function perimeter(userId: string | null): Promise<void> {
  const h = await headers();
  const method = h.get("x-http-method") ?? "";
  const ip = clientIpFromHeaders(h);

  const block = await isBlocked(ip);
  if (block.blocked) {
    throw new AuthError("This address has been blocked. Contact your system administrator.", 403);
  }

  // Origin is checked on state-changing methods only. A GET changes nothing, and
  // the MCP OAuth flow arrives as a top-level GET from claude.ai — see the
  // SameSite note in session.ts.
  if (method && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!assertSameOriginFromHeaders(h)) {
      throw new AuthError("That request did not come from this site.", 403);
    }
  }

  const verdict = await checkRateLimit(RATE_LIMITS.GENERIC, userId ? `${ip}|${userId}` : ip);
  if (!verdict.allowed) {
    await logSecurityEvent({
      eventType: "RATE_LIMIT_EXCEEDED",
      severity: verdict.count > RATE_LIMITS.GENERIC.limit * 10 ? "HIGH" : "MEDIUM",
      ipAddress: ip,
      path: h.get("x-pathname") ?? "unknown",
      method,
      statusCode: 429,
      details: `${verdict.count} requests against the generic rule.`,
    });
    throw new TooManyRequestsError(verdict.retryAfterSeconds);
  }
}

export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSession();
  // Before the 401, so an unauthenticated flood is still counted.
  await perimeter(user?.id ?? null);
  if (!user) throw new AuthError("You must sign in to do that.", 401);
  return user;
}

export async function requireApiRole(...allowed: Role[]): Promise<SessionUser> {
  const user = await requireApiUser();
  if (!allowed.includes(user.role)) {
    throw new AuthError("Your role cannot perform this action.", 403);
  }
  return user;
}
