import "server-only";

import { prisma } from "@/lib/prisma";
import { verifyPin, AuthError } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS, applyProgressiveDelay } from "./rate-limit";
import { logSecurityEvent } from "./events";

/**
 * Re-authenticating at the moment of signature.
 *
 * A session cookie proves somebody signed in on this device within the last
 * twelve hours. It does not prove the person now clicking "Approve" is that
 * somebody. For a maker-checker control on the movement of grid assets that gap
 * is the whole point of the control: an unattended laptop in a KPLC depot must
 * not be able to sign for a transformer, and the audit log must not record a
 * signature nobody made.
 *
 * So the PIN is spent again here, throttled on its own rule. APPROVAL_PIN has
 * existed in RATE_LIMITS since the security pass and was never referenced —
 * this is the caller it was written for. Without it a six-digit PIN behind a
 * bulk endpoint is a million guesses at whatever rate the network allows.
 */
export async function requirePinConfirmation(userId: string, pin: string): Promise<void> {
  const verdict = await checkRateLimit(RATE_LIMITS.APPROVAL_PIN, userId);
  if (!verdict.allowed) {
    throw new AuthError(
      `Too many incorrect PINs. Try again in ${Math.ceil(verdict.retryAfterSeconds / 60)} minutes.`,
      403,
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { pinHash: true } });

  // No such user with a live session should be impossible; treat it as a refusal
  // rather than a crash, and burn the same time so the two are indistinguishable.
  const ok = user ? await verifyPin(pin, user.pinHash) : false;
  if (!ok) {
    await applyProgressiveDelay(verdict.count);
    await logSecurityEvent({
      eventType: "UNAUTHORIZED_ACCESS",
      severity: "HIGH",
      userId,
      statusCode: 403,
      details: `Incorrect PIN on an approval signature (attempt ${verdict.count}).`,
    });
    throw new AuthError("That PIN is not correct. The request was not signed.", 403);
  }
}
