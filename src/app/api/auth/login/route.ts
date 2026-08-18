import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  burnTime,
  verifyPin,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
} from "@/lib/auth";
import {
  createSessionToken,
  isAuthConfigured,
  roleHome,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session";
import { loginSchema } from "@/lib/validation";
import { guard } from "@/lib/security/guard";
import { RATE_LIMITS, applyProgressiveDelay } from "@/lib/security/rate-limit";
import { logSecurityEvent } from "@/lib/security/events";
import { considerAutoBlock } from "@/lib/security/blocklist";
import { createSession } from "@/lib/security/sessions";
import { clientIp } from "@/lib/security/request";
import { assertSameOrigin } from "@/lib/security/csrf";

/**
 * POST /api/auth/login
 *
 * Security decisions worth understanding, because you will be asked:
 *
 * 1. ONE error message. "Invalid email or PIN" covers both a wrong email and a
 *    wrong PIN. Saying "no such user" would let anyone enumerate which KPLC
 *    staff have accounts.
 *
 * 2. We burn bcrypt time even when the email does not exist. Otherwise an
 *    unknown email returns in 1ms and a real one takes ~200ms — and that gap
 *    leaks exactly what the shared message is hiding.
 *
 * 3. Five failures locks the account for fifteen minutes. Without this, six
 *    digits is a million guesses and a script walks straight in.
 *
 * 4. The account lock alone is not enough, because it is per ACCOUNT. An
 *    attacker spraying one common PIN across many email addresses never trips
 *    it. The per-address rate limit is what catches that shape of attack, and
 *    it is applied before the body is even parsed.
 *
 * 5. Progressive delay after each failure. It costs a user who mistyped once
 *    nothing noticeable and makes an online guessing run cost real time.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const ip = clientIp(request);

  if (!assertSameOrigin(request)) {
    await logSecurityEvent({
      eventType: "SUSPICIOUS_ACTIVITY",
      severity: "HIGH",
      request,
      statusCode: 403,
      details: "Cross-origin sign-in attempt.",
    });
    return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  }

  const perimeter = await guard(request, { rule: RATE_LIMITS.LOGIN, inspectBody: true });
  if (!perimeter.ok) return perimeter.response;

  // Fail loudly and specifically. Without this the login would "work", set no
  // usable cookie, and bounce the user back to the login page forever — the
  // single most confusing failure this app could have.
  if (!isAuthConfigured()) {
    console.error("AUTH_SECRET is missing or under 32 characters.");
    return NextResponse.json(
      {
        error:
          "Sign-in is not configured on this server. AUTH_SECRET is missing. Ask an administrator to set it and redeploy.",
      },
      { status: 503 },
    );
  }

  const parsed = loginSchema.safeParse(perimeter.body);
  if (!parsed.success) {
    // Do not echo which field failed — same reasoning as above.
    return NextResponse.json(
      { error: "Invalid email or PIN." },
      { status: 400 },
    );
  }

  const { email, pin } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.active) {
    await burnTime();
    await logSecurityEvent({
      eventType: "LOGIN_FAILED",
      request,
      ipAddress: ip,
      userEmail: email,
      statusCode: 401,
      responseTimeMs: Date.now() - started,
      details: user ? "Account is disabled." : "No account with that email.",
    });
    await considerAutoBlock(ip);
    return NextResponse.json(
      { error: "Invalid email or PIN." },
      { status: 401 },
    );
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60_000,
    );
    await logSecurityEvent({
      eventType: "BRUTE_FORCE_BLOCKED",
      severity: "CRITICAL",
      request,
      ipAddress: ip,
      userId: user.id,
      userEmail: email,
      statusCode: 429,
      responseTimeMs: Date.now() - started,
      details: `Attempt against an account locked for a further ${minutes} minute(s).`,
    });
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
      { status: 429 },
    );
  }

  const valid = await verifyPin(pin, user.pinHash);

  if (!valid) {
    const attempts = user.failedAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;

    await applyProgressiveDelay(attempts);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: lock ? 0 : attempts,
        lockedUntil: lock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null,
      },
    });

    await logSecurityEvent({
      eventType: lock ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
      severity: lock ? "HIGH" : "MEDIUM",
      request,
      ipAddress: ip,
      userId: user.id,
      userEmail: email,
      statusCode: lock ? 429 : 401,
      responseTimeMs: Date.now() - started,
      details: `Wrong PIN, attempt ${attempts} of ${MAX_FAILED_ATTEMPTS}.`,
    });
    await considerAutoBlock(ip);

    if (lock) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.`,
        },
        { status: 429 },
      );
    }

    const left = MAX_FAILED_ATTEMPTS - attempts;
    return NextResponse.json(
      {
        error: `Invalid email or PIN.${left <= 2 ? ` ${left} attempt${left === 1 ? "" : "s"} left before this account locks.` : ""}`,
      },
      { status: 401 },
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const sessionId = await createSession({
    userId: user.id,
    ipAddress: ip,
    userAgent: request.headers.get("user-agent"),
  });

  const session = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    region: user.region,
    storeId: user.storeId,
    sessionId,
  };

  const token = await createSessionToken(session);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

  await logSecurityEvent({
    eventType: "LOGIN_SUCCESS",
    request,
    ipAddress: ip,
    userId: user.id,
    userEmail: user.email,
    statusCode: 200,
    responseTimeMs: Date.now() - started,
    details: `Session ${sessionId}.`,
  });

  return NextResponse.json({
    user: session,
    redirectTo: roleHome(user.role),
  });
}
