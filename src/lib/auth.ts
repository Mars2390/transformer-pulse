import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import {
  SESSION_COOKIE,
  roleHome,
  verifySessionToken,
  type SessionUser,
} from "./session";

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

// --- Lockout policy ---------------------------------------------------------
// Six digits is one million combinations. A script clears that in hours without
// these two numbers.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** Reads the session from cookies. Returns null when not signed in. */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** For pages: returns the user, or sends them to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
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

export async function requireApiUser(): Promise<SessionUser> {
  const user = await getSession();
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
