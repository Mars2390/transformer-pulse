import "server-only";
import { prisma } from "@/lib/prisma";
import { parseUserAgent } from "./request";
import { logSecurityEvent } from "./events";

/**
 * Server-side sessions.
 *
 * A signed JWT on its own answers "was this token issued by us and has it
 * expired". It cannot answer "has this been revoked", "has this person been
 * idle for half an hour", or "how many places is this account signed in from",
 * because a stateless token keeps saying yes until its expiry no matter what
 * happens in between. Those three questions all need a row, and this is it.
 *
 * The token is never stored. The JWT carries this row's id as a claim, so a
 * stolen database yields session metadata and no usable credential.
 */

export const INACTIVITY_TIMEOUT_MINUTES = 30;
export const MAX_CONCURRENT_SESSIONS = 3;
export const SESSION_LIFETIME_HOURS = 12;

export async function createSession(opts: {
  userId: string;
  ipAddress: string;
  userAgent: string | null;
}): Promise<string> {
  const device = parseUserAgent(opts.userAgent);

  // Oldest-out when the cap is reached.
  //
  // Refusing the NEW sign-in instead would be the wrong choice here: it hands
  // an attacker a denial of service (open three sessions, the real engineer
  // can no longer get in) and it strands a user whose phone died mid-shift
  // holding a session they cannot close.
  const active = await prisma.userSession.findMany({
    where: { userId: opts.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActivityAt: "asc" },
    select: { id: true },
  });

  if (active.length >= MAX_CONCURRENT_SESSIONS) {
    const excess = active.slice(0, active.length - MAX_CONCURRENT_SESSIONS + 1);
    await prisma.userSession.updateMany({
      where: { id: { in: excess.map((s) => s.id) } },
      data: { revokedAt: new Date(), revokedReason: "Concurrent session limit reached" },
    });
    await logSecurityEvent({
      eventType: "CONCURRENT_SESSION_LIMIT",
      userId: opts.userId,
      ipAddress: opts.ipAddress,
      path: "/api/auth/login",
      method: "POST",
      statusCode: 200,
      details: `Signed out ${excess.length} least-recently-used session(s); the cap is ${MAX_CONCURRENT_SESSIONS}.`,
    });
  }

  const session = await prisma.userSession.create({
    data: {
      userId: opts.userId,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent?.slice(0, 400) ?? null,
      deviceType: device.deviceType,
      browser: device.browser,
      os: device.os,
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_HOURS * 3_600_000),
    },
    select: { id: true },
  });

  return session.id;
}

export type SessionCheck =
  | { valid: true }
  | { valid: false; reason: "REVOKED" | "EXPIRED" | "IDLE" | "UNKNOWN" };

/**
 * Validates a session and slides its activity clock forward.
 *
 * The write is throttled to once a minute. Updating lastActivityAt on every
 * request would put a row write on every page load in the system for the sake
 * of a thirty-minute timer, which is a lot of database traffic to measure
 * something that changes slowly.
 */
export async function touchSession(sessionId: string): Promise<SessionCheck> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastActivityAt: true },
  });

  if (!session) return { valid: false, reason: "UNKNOWN" };
  if (session.revokedAt) return { valid: false, reason: "REVOKED" };

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return { valid: false, reason: "EXPIRED" };

  const idleMs = now - session.lastActivityAt.getTime();
  if (idleMs > INACTIVITY_TIMEOUT_MINUTES * 60_000) {
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: `Idle for more than ${INACTIVITY_TIMEOUT_MINUTES} minutes` },
    });
    return { valid: false, reason: "IDLE" };
  }

  if (idleMs > 60_000) {
    await prisma.userSession
      .update({ where: { id: sessionId }, data: { lastActivityAt: new Date() } })
      .catch(() => undefined);
  }

  return { valid: true };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.userSession
    .update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokedReason: reason } })
    .catch(() => undefined);
}

/**
 * Ends every session a user has.
 *
 * Called on PIN change. A credential change that leaves old sessions alive
 * means a compromised account stays compromised after the user has done the
 * one thing they were told to do about it.
 */
export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const { count } = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}

export async function activeSessionCount(): Promise<number> {
  return prisma.userSession.count({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
  });
}
