import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Rate limiting, counted in Postgres.
 *
 * This is deliberately NOT an in-memory Map, and the reason is the difference
 * between a control and a decoration. On Vercel every request may land on a
 * fresh lambda, and concurrent requests certainly land on different ones. An
 * in-memory counter is therefore per-instance: "5 attempts per 15 minutes"
 * becomes "5 per instance", and an attacker opening twenty connections in
 * parallel gets a hundred. The limiter still looks correct in code review, in
 * unit tests, and on the architecture diagram. It just does not limit anything.
 *
 * The cost of doing it properly is one indexed upsert per limited request.
 * That is a few milliseconds against a database the request is about to use
 * anyway, and it is the price of the control being real.
 *
 * Windows are fixed, not sliding. A fixed window allows a burst across a
 * boundary — up to 2x the limit in a short span — and a sliding log would not.
 * Fixed is chosen because it costs one row per key per window instead of one
 * row per request, and the boundary burst does not matter for the thing this
 * protects against: nobody brute-forces a six-digit PIN at 2x5 attempts.
 */

export type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
};

/** The tuned rules. Anything not listed falls back to GENERIC. */
export const RATE_LIMITS = {
  LOGIN: { name: "login", limit: 5, windowSeconds: 15 * 60 },
  PIN: { name: "pin", limit: 5, windowSeconds: 15 * 60 },
  APPROVAL_PIN: { name: "approval-pin", limit: 5, windowSeconds: 15 * 60 },
  REPORTS: { name: "reports", limit: 20, windowSeconds: 60 * 60 },
  UPLOADS: { name: "uploads", limit: 10, windowSeconds: 60 * 60 },
  SEARCH: { name: "search", limit: 30, windowSeconds: 60 },
  GENERIC: { name: "generic", limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitVerdict = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. Goes straight into Retry-After. */
  retryAfterSeconds: number;
  count: number;
};

function windowStartFor(windowSeconds: number, now: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now / ms) * ms);
}

/**
 * Counts one hit against a rule and says whether it is allowed.
 *
 * The increment is an upsert, which Postgres executes as a single statement
 * under a unique constraint on (bucketKey, windowStart). Two concurrent
 * requests therefore cannot both read 4 and both write 5 — the second blocks
 * on the row lock and increments the value the first committed. A
 * read-then-write in application code would have exactly that race, and it
 * would show up only under the concurrency an attacker generates.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  identifier: string,
): Promise<RateLimitVerdict> {
  const now = Date.now();
  const windowStart = windowStartFor(rule.windowSeconds, now);
  const bucketKey = `${rule.name}:${identifier}`;
  const resetAt = windowStart.getTime() + rule.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  try {
    const bucket = await prisma.rateLimitBucket.upsert({
      where: { bucketKey_windowStart: { bucketKey, windowStart } },
      create: { bucketKey, windowStart, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });

    return {
      allowed: bucket.count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - bucket.count),
      retryAfterSeconds,
      count: bucket.count,
    };
  } catch (error) {
    // Fail OPEN, and say so loudly.
    //
    // If the counter is unreachable the database is in trouble, and in that
    // state refusing every request turns a database problem into a total
    // outage. The trade is accepted knowingly: an attacker who can break the
    // database can also bypass the limiter, but an attacker who can break the
    // database has already won more than this.
    console.error("Rate limiter unavailable, failing open:", error);
    return { allowed: true, limit: rule.limit, remaining: rule.limit, retryAfterSeconds: 0, count: 0 };
  }
}

/** Reads the count without spending an attempt. For dashboards and pre-checks. */
export async function peekRateLimit(rule: RateLimitRule, identifier: string): Promise<number> {
  const windowStart = windowStartFor(rule.windowSeconds, Date.now());
  const row = await prisma.rateLimitBucket.findUnique({
    where: { bucketKey_windowStart: { bucketKey: `${rule.name}:${identifier}`, windowStart } },
    select: { count: true },
  });
  return row?.count ?? 0;
}

/**
 * Progressive delay: 1s, 2s, 4s, 8s, capped.
 *
 * Applied after a failed credential attempt. Its purpose is not to stop a
 * determined attacker — it is to make an online guessing run cost real
 * wall-clock time while remaining invisible to somebody who simply mistyped
 * once. The cap exists because an unbounded backoff is a way to pin a serverless
 * function open, which the attacker would be delighted to pay for.
 */
export function progressiveDelayMs(failureCount: number): number {
  if (failureCount <= 0) return 0;
  return Math.min(8000, 2 ** Math.min(failureCount - 1, 3) * 1000);
}

export async function applyProgressiveDelay(failureCount: number): Promise<void> {
  const ms = progressiveDelayMs(failureCount);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** Housekeeping. Old windows are dead weight on an index that is read constantly. */
export async function pruneRateLimits(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const { count } = await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: cutoff } } });
  return count;
}
