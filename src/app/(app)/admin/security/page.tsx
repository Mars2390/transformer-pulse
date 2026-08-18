import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, EmptyState, Badge } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { AutoRefresh } from "@/components/app/AutoRefresh";
import { BlocklistPanel } from "@/components/admin/BlocklistPanel";
import { activeSessionCount } from "@/lib/security/sessions";
import type { SecuritySeverity } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<SecuritySeverity, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Signed in",
  LOGIN_FAILED: "Failed sign-in",
  LOGOUT: "Signed out",
  ACCOUNT_LOCKED: "Account locked",
  BRUTE_FORCE_BLOCKED: "Brute force blocked",
  PIN_BRUTE_FORCE: "PIN guessing",
  SQL_INJECTION_ATTEMPT: "SQL injection probe",
  XSS_ATTEMPT: "XSS probe",
  RATE_LIMIT_EXCEEDED: "Rate limit hit",
  TOKEN_INVALID: "Invalid token",
  UNAUTHORIZED_ACCESS: "Unauthorised access",
  IP_BLOCKED: "Address blocked",
  IP_UNBLOCKED: "Address released",
  SESSION_REVOKED: "Session ended",
  CONCURRENT_SESSION_LIMIT: "Session cap reached",
  SESSION_EXPIRED: "Session expired",
  UPLOAD_REJECTED: "Upload rejected",
  SUSPICIOUS_ACTIVITY: "Suspicious activity",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; severity?: string; ip?: string; hours?: string }>;
}) {
  await requireRole("ADMIN");
  const sp = await searchParams;

  const hours = Math.min(720, Math.max(1, Number(sp.hours) || 24));
  const since = new Date(Date.now() - hours * 3_600_000);

  const where = {
    createdAt: { gte: since },
    ...(sp.type ? { eventType: sp.type as never } : {}),
    ...(sp.severity ? { severity: sp.severity as SecuritySeverity } : {}),
    ...(sp.ip ? { ipAddress: sp.ip } : {}),
  };

  const [events, total, failedLogins, rateLimitHits, blockedIps, sessions, bySeverity, topIps] =
    await Promise.all([
      prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.securityEvent.count({ where: { createdAt: { gte: since } } }),
      prisma.securityEvent.count({
        where: { createdAt: { gte: since }, eventType: { in: ["LOGIN_FAILED", "ACCOUNT_LOCKED", "BRUTE_FORCE_BLOCKED"] } },
      }),
      prisma.securityEvent.count({ where: { createdAt: { gte: since }, eventType: "RATE_LIMIT_EXCEEDED" } }),
      prisma.blockedIp.count(),
      activeSessionCount(),
      prisma.securityEvent.groupBy({
        by: ["severity"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.securityEvent.groupBy({
        by: ["ipAddress"],
        where: {
          createdAt: { gte: since },
          eventType: { in: ["LOGIN_FAILED", "RATE_LIMIT_EXCEEDED", "SQL_INJECTION_ATTEMPT", "XSS_ATTEMPT", "UNAUTHORIZED_ACCESS", "SUSPICIOUS_ACTIVITY"] },
        },
        _count: { _all: true },
        orderBy: { _count: { ipAddress: "desc" } },
        take: 10,
      }),
    ]);

  const severityOf = (s: SecuritySeverity) => bySeverity.find((r) => r.severity === s)?._count._all ?? 0;
  const critical = severityOf("CRITICAL");

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { type: sp.type, severity: sp.severity, ip: sp.ip, hours: sp.hours, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
            ← Admin
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Security</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-ink-soft">
            Every authentication attempt, refusal and probe against this system in the last{" "}
            {hours} hours. Addresses are recorded as seen; locations are resolved afterwards
            rather than while somebody is trying to sign in.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[24, 72, 168].map((h) => (
            <Link
              key={h}
              href={`/admin/security${qs({ hours: String(h) })}`}
              className={`inline-flex min-h-11 items-center rounded-lg px-4 text-xs font-bold ${
                hours === h ? "bg-navy text-white" : "border border-line bg-white text-navy hover:border-kplc"
              }`}
            >
              {h === 24 ? "24 hours" : h === 72 ? "3 days" : "7 days"}
            </Link>
          ))}
        </div>
      </div>

      {critical > 0 && (
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-5 py-4">
          <p className="text-sm font-extrabold text-red-900">
            {formatNumber(critical)} critical event{critical === 1 ? "" : "s"} in this window
          </p>
          <p className="mt-1 text-xs text-red-800">
            Critical means a locked account was attacked again, or an address was refused outright.
            Look at the top addresses below before anything else.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Security events" value={formatNumber(total)} hint={`last ${hours}h`} />
        <StatTile label="Failed sign-ins" value={formatNumber(failedLogins)} tone={failedLogins ? "warning" : "neutral"} hint="wrong PIN or unknown email" />
        <StatTile label="Rate limit hits" value={formatNumber(rateLimitHits)} tone={rateLimitHits ? "warning" : "neutral"} hint="requests refused" />
        <StatTile label="Blocked addresses" value={formatNumber(blockedIps)} tone={blockedIps ? "danger" : "neutral"} hint="currently refused" />
        <StatTile label="Active sessions" value={formatNumber(sessions)} tone="info" hint="signed in now" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/admin/security${qs({ severity: undefined, type: undefined, ip: undefined })}`}
          className={`inline-flex min-h-11 items-center rounded-lg px-4 text-xs font-bold ${
            !sp.severity && !sp.type && !sp.ip ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"
          }`}
        >
          All {formatNumber(total)}
        </Link>
        {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as SecuritySeverity[]).map((s) => (
          <Link
            key={s}
            href={`/admin/security${qs({ severity: s, type: undefined })}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-xs font-bold ${
              sp.severity === s ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"
            }`}
          >
            {s} {formatNumber(severityOf(s))}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`${events.length} event${events.length === 1 ? "" : "s"}${events.length === 200 ? " (most recent 200)" : ""}`} />
          {events.length === 0 ? (
            <EmptyState message="Nothing recorded in this window. That is the expected state." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-xs">
                <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">Device</th>
                    <th className="px-3 py-2">Path</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {events.map((e) => (
                    <tr key={e.id} className={e.severity === "CRITICAL" ? "bg-red-50/50" : e.severity === "HIGH" ? "bg-amber-50/40" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-ink-soft">
                        {e.createdAt.toISOString().slice(5, 19).replace("T", " ")}
                      </td>
                      <td className="px-3 py-2 font-semibold text-navy">{EVENT_LABELS[e.eventType] ?? e.eventType}</td>
                      <td className="px-3 py-2">
                        <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                      </td>
                      <td className="max-w-[170px] truncate px-3 py-2 text-ink-soft">
                        {e.user?.name ?? e.userEmail ?? "anonymous"}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/security${qs({ ip: e.ipAddress })}`} className="font-mono text-[11px] text-kplc hover:underline">
                          {e.ipAddress}
                        </Link>
                        {e.location ? <span className="ml-1 text-ink-soft">{e.location}</span> : null}
                      </td>
                      <td className="max-w-[150px] truncate px-3 py-2 text-ink-soft">
                        {[e.browser, e.os, e.deviceType].filter((x) => x && x !== "unknown").join(" · ") || "—"}
                      </td>
                      <td className="max-w-[190px] truncate px-3 py-2 font-mono text-[11px] text-ink-soft" title={e.details ?? undefined}>
                        {e.method} {e.path}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Top addresses by refusal" />
            {topIps.length === 0 ? (
              <EmptyState message="No address has been refused in this window." />
            ) : (
              <ul className="divide-y divide-line">
                {topIps.map((row) => (
                  <li key={row.ipAddress} className="flex items-center gap-3 px-5 py-2.5">
                    <Link href={`/admin/security${qs({ ip: row.ipAddress })}`} className="min-w-0 flex-1 truncate font-mono text-xs text-kplc hover:underline">
                      {row.ipAddress}
                    </Link>
                    <span className={`text-xs font-bold ${row._count._all >= 20 ? "text-red-700" : "text-ink-soft"}`}>
                      {formatNumber(row._count._all)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-ink-soft">
              A high count from one address is not proof of an attacker. Kenyan mobile carriers
              put whole regions behind one address, so blocking is time-boxed by default and a
              permanent block is a decision, not a reflex.
            </p>
          </Card>

          <BlocklistPanel />
        </div>
      </div>
    </div>
  );
}
