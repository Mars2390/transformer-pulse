import "server-only";
import { prisma } from "@/lib/prisma";
import { logSecurityEvent, recentFailureCount } from "./events";

/**
 * Refusing an address outright.
 *
 * The operational risk here is larger than the security benefit, and getting
 * the balance wrong is worse than not having the feature.
 *
 * Kenyan mobile networks put very large numbers of subscribers behind
 * carrier-grade NAT. One address can therefore be an entire town's Safaricom
 * handsets. Blocking it because twenty failed logins arrived from it does not
 * stop one attacker — it takes every field engineer on that carrier out of the
 * system, and the people it locks out are the ones standing under transformers
 * with no other way to report a fault.
 *
 * Three rules follow from that, and they are the whole design:
 *
 *   1. Automatic blocks ALWAYS expire. One hour, not forever.
 *   2. The automatic threshold is high (20 failures in 15 minutes), well above
 *      anything a confused user produces, because the rate limiter has already
 *      been slowing this address down since attempt six.
 *   3. Only a human may block permanently, and that decision is itself logged
 *      with their name against it.
 *
 * Blocking is the last line, not the first. The rate limiter does the work.
 */

export const AUTO_BLOCK_THRESHOLD = 20;
export const AUTO_BLOCK_WINDOW_MINUTES = 15;
export const AUTO_BLOCK_DURATION_MINUTES = 60;

export type BlockStatus = { blocked: boolean; reason?: string; expiresAt?: Date | null };

export async function isBlocked(ipAddress: string): Promise<BlockStatus> {
  if (ipAddress === "unknown") return { blocked: false };

  const row = await prisma.blockedIp.findUnique({ where: { ipAddress } });
  if (!row) return { blocked: false };

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    // Expired blocks are removed on read rather than by a sweeper, so an
    // address is never refused a second longer than it was sentenced to.
    await prisma.blockedIp.delete({ where: { ipAddress } }).catch(() => undefined);
    return { blocked: false };
  }

  await prisma.blockedIp
    .update({ where: { ipAddress }, data: { hitsSinceBlock: { increment: 1 } } })
    .catch(() => undefined);

  return { blocked: true, reason: row.reason, expiresAt: row.expiresAt };
}

export async function blockIp(opts: {
  ipAddress: string;
  reason: string;
  source: "AUTOMATIC" | "MANUAL";
  blockedById?: string | null;
  durationMinutes?: number | null;
}): Promise<void> {
  if (opts.ipAddress === "unknown") return;

  // A permanent block is a human decision. An automatic path that asks for one
  // is a bug, and is downgraded rather than honoured.
  const duration =
    opts.source === "AUTOMATIC"
      ? (opts.durationMinutes ?? AUTO_BLOCK_DURATION_MINUTES)
      : (opts.durationMinutes ?? null);

  const expiresAt = duration ? new Date(Date.now() + duration * 60_000) : null;

  await prisma.blockedIp.upsert({
    where: { ipAddress: opts.ipAddress },
    create: {
      ipAddress: opts.ipAddress,
      reason: opts.reason,
      source: opts.source,
      blockedById: opts.blockedById ?? null,
      expiresAt,
    },
    update: { reason: opts.reason, source: opts.source, expiresAt, blockedById: opts.blockedById ?? null },
  });

  await logSecurityEvent({
    eventType: "IP_BLOCKED",
    severity: "HIGH",
    ipAddress: opts.ipAddress,
    userId: opts.blockedById ?? null,
    path: "/security/blocklist",
    method: "INTERNAL",
    statusCode: 403,
    details: `${opts.source} block: ${opts.reason}${expiresAt ? ` (expires ${expiresAt.toISOString()})` : " (permanent)"}`,
  });
}

export async function unblockIp(ipAddress: string, actorId: string): Promise<void> {
  await prisma.blockedIp.delete({ where: { ipAddress } }).catch(() => undefined);
  await logSecurityEvent({
    eventType: "IP_UNBLOCKED",
    severity: "MEDIUM",
    ipAddress,
    userId: actorId,
    path: "/security/blocklist",
    method: "INTERNAL",
    statusCode: 200,
    details: "Unblocked by an administrator.",
  });
}

/**
 * Called after a failed credential attempt. Blocks only well past the point
 * where the rate limiter has already been refusing this address.
 */
export async function considerAutoBlock(ipAddress: string): Promise<boolean> {
  if (ipAddress === "unknown") return false;

  const failures = await recentFailureCount(ipAddress, AUTO_BLOCK_WINDOW_MINUTES);
  if (failures < AUTO_BLOCK_THRESHOLD) return false;

  const existing = await prisma.blockedIp.findUnique({ where: { ipAddress } });
  if (existing) return true;

  await blockIp({
    ipAddress,
    reason: `${failures} failed attempts in ${AUTO_BLOCK_WINDOW_MINUTES} minutes`,
    source: "AUTOMATIC",
  });
  return true;
}
