import "server-only";
import { prisma } from "@/lib/prisma";
import type { SecurityEventType, SecuritySeverity } from "@/generated/prisma/enums";
import { clientIp, parseUserAgent } from "./request";

/**
 * Writing to the security log.
 *
 * The one rule that matters here: logging must never be able to fail a
 * request. If the SecurityEvent insert throws — the table is missing during a
 * migration, the pool is exhausted — a field engineer must still be able to
 * sign in and report a fault. A security control that takes the system down
 * when it breaks has converted itself into the outage it was meant to prevent.
 *
 * So every write is wrapped, and a failure is reported to stderr and dropped.
 * The alternative, refusing the request when it cannot be logged, is a real
 * design choice some banks make; it is the wrong one for a utility whose users
 * are standing under a broken transformer.
 */

export type SecurityEventInput = {
  eventType: SecurityEventType;
  severity?: SecuritySeverity;
  request?: Request;
  ipAddress?: string;
  userAgent?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  path?: string;
  method?: string;
  statusCode?: number;
  responseTimeMs?: number | null;
  details?: string | null;
};

const DEFAULT_SEVERITY: Record<string, SecuritySeverity> = {
  LOGIN_FAILED: "MEDIUM",
  LOGIN_SUCCESS: "LOW",
  LOGOUT: "LOW",
  ACCOUNT_LOCKED: "HIGH",
  BRUTE_FORCE_BLOCKED: "CRITICAL",
  PIN_BRUTE_FORCE: "HIGH",
  SQL_INJECTION_ATTEMPT: "HIGH",
  XSS_ATTEMPT: "HIGH",
  RATE_LIMIT_EXCEEDED: "MEDIUM",
  TOKEN_INVALID: "MEDIUM",
  UNAUTHORIZED_ACCESS: "MEDIUM",
  IP_BLOCKED: "HIGH",
  IP_UNBLOCKED: "MEDIUM",
  SESSION_REVOKED: "LOW",
  CONCURRENT_SESSION_LIMIT: "MEDIUM",
  SESSION_EXPIRED: "LOW",
  UPLOAD_REJECTED: "MEDIUM",
  SUSPICIOUS_ACTIVITY: "HIGH",
};

export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    const req = input.request;
    const ua = input.userAgent ?? req?.headers.get("user-agent") ?? null;
    const device = parseUserAgent(ua);
    const url = req ? new URL(req.url) : null;

    await prisma.securityEvent.create({
      data: {
        eventType: input.eventType,
        severity: input.severity ?? DEFAULT_SEVERITY[input.eventType] ?? "LOW",
        userId: input.userId ?? null,
        userEmail: input.userEmail?.slice(0, 160) ?? null,
        ipAddress: input.ipAddress ?? (req ? clientIp(req) : "unknown"),
        userAgent: ua?.slice(0, 400) ?? null,
        deviceType: device.deviceType,
        browser: device.browser,
        os: device.os,
        path: (input.path ?? url?.pathname ?? "unknown").slice(0, 300),
        method: input.method ?? req?.method ?? "UNKNOWN",
        statusCode: input.statusCode ?? 0,
        responseTimeMs: input.responseTimeMs ?? null,
        details: input.details?.slice(0, 2000) ?? null,
      },
    });
  } catch (error) {
    console.error("SecurityEvent write failed (request continues):", error);
  }
}

/** Fire-and-forget for hot paths where even the insert latency is unwanted. */
export function logSecurityEventAsync(input: SecurityEventInput): void {
  void logSecurityEvent(input);
}

/**
 * How many times this address has failed in the window.
 *
 * Counted from the event log rather than a separate counter, so the number an
 * analyst sees on the dashboard and the number the auto-blocker acts on are
 * the same number, derived the same way. Two counters would eventually
 * disagree, and the disagreement would be discovered during an incident.
 */
export async function recentFailureCount(
  ipAddress: string,
  withinMinutes: number,
  types: SecurityEventType[] = ["LOGIN_FAILED", "PIN_BRUTE_FORCE", "TOKEN_INVALID", "UNAUTHORIZED_ACCESS"],
): Promise<number> {
  const since = new Date(Date.now() - withinMinutes * 60_000);
  return prisma.securityEvent.count({
    where: { ipAddress, eventType: { in: types }, createdAt: { gte: since } },
  });
}
