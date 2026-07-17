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
  roleHome,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
} from "@/lib/session";
import { loginSchema } from "@/lib/validation";

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
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
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
    return NextResponse.json(
      { error: "Invalid email or PIN." },
      { status: 401 },
    );
  }

  // --- Locked out? ---------------------------------------------------------
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60_000,
    );
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      },
      { status: 429 },
    );
  }

  // --- Check the PIN -------------------------------------------------------
  const valid = await verifyPin(pin, user.pinHash);

  if (!valid) {
    const attempts = user.failedAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: lock ? 0 : attempts,
        lockedUntil: lock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null,
      },
    });

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

  // --- Success -------------------------------------------------------------
  if (user.failedAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  const session = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    region: user.region,
    storeId: user.storeId,
  };

  const token = await createSessionToken(session);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);

  return NextResponse.json({
    user: session,
    redirectTo: roleHome(user.role),
  });
}
