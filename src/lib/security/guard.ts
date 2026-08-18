import "server-only";
import { NextResponse } from "next/server";
import { clientIp, looksAutomated } from "./request";
import { isBlocked } from "./blocklist";
import { checkRateLimit, RATE_LIMITS, type RateLimitRule } from "./rate-limit";
import { detectAttack } from "./detect";
import { logSecurityEvent } from "./events";

/**
 * One wrapper that applies the perimeter to an API route.
 *
 * Why this is not middleware: Next.js middleware runs in the Edge runtime,
 * which cannot open a database connection, and every control here — the
 * blocklist, the rate counter, the event log — is database-backed for the
 * reasons set out in rate-limit.ts. Middleware handles what needs no state
 * (security headers, cookie signature checks); anything requiring a lookup
 * happens in the Node runtime, which is here.
 *
 * Order is deliberate:
 *   1. Blocked address  — cheapest refusal, and a blocked caller earns nothing.
 *   2. Rate limit       — spends the attempt before the body is parsed, so a
 *                         huge payload cannot be used to make the check itself
 *                         expensive.
 *   3. Payload inspection — logs probes, but does not pretend to be the
 *                         defence; see detect.ts.
 */

export type GuardOptions = {
  rule?: RateLimitRule;
  /** Include the signed-in user in the key so one abusive user cannot exhaust a shared office IP. */
  userId?: string | null;
  /** Read and inspect the JSON body. Off for GETs and for large uploads. */
  inspectBody?: boolean;
};

export type GuardResult =
  | { ok: true; ip: string; body: unknown }
  | { ok: false; response: NextResponse; ip: string };

export async function guard(request: Request, options: GuardOptions = {}): Promise<GuardResult> {
  const started = Date.now();
  const ip = clientIp(request);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const rule = options.rule ?? RATE_LIMITS.GENERIC;

  const block = await isBlocked(ip);
  if (block.blocked) {
    await logSecurityEvent({
      eventType: "UNAUTHORIZED_ACCESS",
      severity: "HIGH",
      request,
      ipAddress: ip,
      path,
      method,
      statusCode: 403,
      responseTimeMs: Date.now() - started,
      details: `Request from blocked address. ${block.reason ?? ""}`,
    });
    return {
      ok: false,
      ip,
      response: NextResponse.json(
        { error: "This address has been blocked. Contact your system administrator." },
        { status: 403 },
      ),
    };
  }

  const identifier = options.userId ? `${ip}|${options.userId}` : ip;
  const verdict = await checkRateLimit(rule, identifier);
  if (!verdict.allowed) {
    await logSecurityEvent({
      eventType: "RATE_LIMIT_EXCEEDED",
      severity: verdict.count > rule.limit * 10 ? "HIGH" : "MEDIUM",
      request,
      ipAddress: ip,
      path,
      method,
      statusCode: 429,
      responseTimeMs: Date.now() - started,
      details: `${verdict.count} requests against the ${rule.name} rule (limit ${rule.limit} per ${rule.windowSeconds}s).`,
    });

    return {
      ok: false,
      ip,
      response: NextResponse.json(
        { error: "Too many requests. Wait a moment and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(verdict.retryAfterSeconds),
            "X-RateLimit-Limit": String(verdict.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.floor((Date.now() + verdict.retryAfterSeconds * 1000) / 1000)),
          },
        },
      ),
    };
  }

  let body: unknown = undefined;
  if (options.inspectBody && method !== "GET" && method !== "HEAD") {
    body = await request.json().catch(() => null);

    const hit = detectAttack(body) ?? detectAttack(Object.fromEntries(url.searchParams));
    if (hit) {
      await logSecurityEvent({
        eventType: hit.kind === "XSS" ? "XSS_ATTEMPT" : hit.kind === "SQL" ? "SQL_INJECTION_ATTEMPT" : "SUSPICIOUS_ACTIVITY",
        severity: "HIGH",
        request,
        ipAddress: ip,
        path,
        method,
        statusCode: 400,
        responseTimeMs: Date.now() - started,
        details: `${hit.label} — ${hit.sample}`,
      });

      // Generic message on purpose. Telling the prober which rule fired hands
      // them the shape of the filter, and the filter is not the control anyway.
      return {
        ok: false,
        ip,
        response: NextResponse.json({ error: "That request could not be processed." }, { status: 400 }),
      };
    }
  }

  if (looksAutomated(request.headers.get("user-agent")) && rule.name !== "generic") {
    await logSecurityEvent({
      eventType: "SUSPICIOUS_ACTIVITY",
      severity: "MEDIUM",
      request,
      ipAddress: ip,
      path,
      method,
      statusCode: 0,
      details: "Automated client on a credential or upload route.",
    });
  }

  return { ok: true, ip, body };
}

/** Rate-limit headers on a successful response, so honest clients can back off. */
export function withRateLimitHeaders(response: NextResponse, remaining: number, limit: number): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(limit));
  response.headers.set("X-RateLimit-Remaining", String(remaining));
  return response;
}
