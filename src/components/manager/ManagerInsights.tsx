import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { Card, CardHeader, StatTile, Badge } from "@/components/ui";
import { MiniBarChart } from "./MiniBarChart";
import { computeWarranty } from "@/lib/warranty";
import { formatKesCompact, formatNumber } from "@/lib/format";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The manager's insight band: trends, today's digest, recovered money, upcoming
 * warranty expirations, and a region comparison. A server component — it runs
 * its own queries and renders static markup, so the parent dashboard's
 * auto-refresh keeps it current with no client JS of its own.
 */
export async function ManagerInsights({
  region,
  isAdmin,
}: {
  region: string | null;
  isAdmin: boolean;
}) {
  const scope: Prisma.TransformerWhereInput = region ? { region } : {};
  const eventScope: Prisma.LifecycleEventWhereInput = { transformer: scope };

  // Six-month window for the trend charts.
  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const dayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const in90 = new Date(Date.now() + 90 * DAY);

  const [faultEvents, installEvents, todayCounts, settled, expiring, regionRows] = await Promise.all([
    prisma.lifecycleEvent.findMany({
      where: { ...eventScope, type: "FAULT_REPORTED", occurredAt: { gte: windowStart } },
      select: { occurredAt: true },
    }),
    prisma.lifecycleEvent.findMany({
      where: { ...eventScope, type: "INSTALLED", occurredAt: { gte: windowStart } },
      select: { occurredAt: true },
    }),
    prisma.lifecycleEvent.groupBy({
      by: ["type"],
      where: { ...eventScope, occurredAt: { gte: dayStart } },
      _count: { _all: true },
    }),
    prisma.warrantyClaim.findMany({
      where: { status: "CLOSED", transformer: scope },
      select: { claimValueKes: true },
    }),
    prisma.transformer.findMany({
      where: { ...scope, status: { in: ["IN_FIELD", "IN_STORE"] }, warrantyStart: { not: null } },
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, warrantyStart: true, warrantyMonths: true },
    }),
    // Region comparison — for an admin, every region; for a manager, just theirs.
    prisma.transformer.findMany({
      where: scope,
      select: { region: true, status: true },
    }),
  ]);

  const buckets = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return { label: MONTHS[d.getMonth()], key: `${d.getFullYear()}-${d.getMonth()}`, faults: 0, installs: 0 };
  });
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  for (const e of faultEvents) { const b = buckets.find((x) => x.key === keyOf(e.occurredAt)); if (b) b.faults++; }
  for (const e of installEvents) { const b = buckets.find((x) => x.key === keyOf(e.occurredAt)); if (b) b.installs++; }

  const faultTrend = buckets[5].faults - buckets[4].faults;
  const faultWord = faultTrend > 0 ? "up" : faultTrend < 0 ? "down" : "steady";

  const countToday = (type: string) => todayCounts.find((c) => c.type === type)?._count._all ?? 0;
  const digest = [
    { label: "installations", n: countToday("INSTALLED") },
    { label: "inspections", n: countToday("INSPECTED") },
    { label: "faults reported", n: countToday("FAULT_REPORTED") },
    { label: "dispatches", n: countToday("DISPATCHED") },
  ].filter((d) => d.n > 0);

  const recovered = settled.reduce((s, c) => s + Number(c.claimValueKes ?? 0), 0);

  const expSoon = expiring
    .map((tx) => ({ tx, w: computeWarranty(tx.warrantyStart, tx.warrantyMonths) }))
    .filter(({ w }) => w.expiresAt && w.expiresAt <= in90 && (w.daysRemaining ?? 0) > 0);
  const expByMonth = new Map<string, { label: string; count: number }>();
  for (const { w } of expSoon) {
    const d = w.expiresAt!;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const entry = expByMonth.get(key) ?? { label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, count: 0 };
    entry.count++;
    expByMonth.set(key, entry);
  }

  const byRegion = new Map<string, { total: number; faulty: number; field: number }>();
  for (const t of regionRows) {
    const r = t.region ?? "Unassigned";
    const e = byRegion.get(r) ?? { total: 0, faulty: 0, field: 0 };
    e.total++;
    if (t.status === "FAULTY") e.faulty++;
    if (t.status === "IN_FIELD") e.field++;
    byRegion.set(r, e);
  }
  const regionCompare = [...byRegion.entries()]
    .map(([name, s]) => ({
      name,
      total: s.total,
      faulty: s.faulty,
      healthyPct: s.field + s.faulty > 0 ? Math.round((s.field / (s.field + s.faulty)) * 100) : 100,
    }))
    .sort((a, b) => b.healthyPct - a.healthyPct);

  return (
    <div className="space-y-6">
      {/* Digest + recovered money */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-navy">Today so far</h2>
          <p className="mt-2 text-sm text-ink-soft">
            {digest.length === 0
              ? "Nothing recorded yet today."
              : digest.map((d, i) => (
                  <span key={d.label}>
                    <span className="font-bold text-navy">{d.n}</span> {d.label}
                    {i < digest.length - 1 ? ", " : "."}
                  </span>
                ))}
          </p>
        </Card>
        <StatTile
          label="Recovered via warranty"
          value={formatKesCompact(recovered)}
          tone="success"
          hint="Claims settled — the ROI"
        />
      </div>

      {/* Trend charts */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-navy">Faults per month</h2>
            <span className={`text-xs font-bold ${faultWord === "up" ? "text-red-600" : faultWord === "down" ? "text-emerald-600" : "text-ink-soft"}`}>
              trending {faultWord}
            </span>
          </div>
          <div className="mt-3">
            <MiniBarChart data={buckets.map((b) => ({ label: b.label, value: b.faults }))} colour="#c02626" />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy">Installations per month</h2>
          <div className="mt-3">
            <MiniBarChart data={buckets.map((b) => ({ label: b.label, value: b.installs }))} colour="#0e8a4f" />
          </div>
        </Card>
      </div>

      {/* Warranty calendar + region comparison */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={`Warranty expiring in 90 days (${expSoon.length})`}
            action={<Link href="/manager/warranty" className="inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline">Claims →</Link>}
          />
          {expByMonth.size === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-soft">No warranties expiring in the next 90 days.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...expByMonth.values()].map((m) => (
                <li key={m.label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm font-medium text-navy">{m.label}</span>
                  <Badge tone="warning">{m.count} unit{m.count === 1 ? "" : "s"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={isAdmin ? "Region comparison" : "Region health"} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-[11px] font-bold tracking-wide text-ink-soft">
                <tr>
                  <th className="px-5 py-3">REGION</th>
                  <th className="px-5 py-3">TOTAL</th>
                  <th className="px-5 py-3">FAULTY</th>
                  <th className="px-5 py-3">HEALTHY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {regionCompare.map((r) => (
                  <tr key={r.name} className="hover:bg-surface">
                    <td className="px-5 py-3 font-semibold text-navy">{r.name}</td>
                    <td className="px-5 py-3 text-ink-soft">{formatNumber(r.total)}</td>
                    <td className="px-5 py-3">
                      {r.faulty > 0 ? <Badge tone="danger">{r.faulty}</Badge> : <span className="text-ink-soft">0</span>}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={r.healthyPct >= 90 ? "success" : r.healthyPct >= 70 ? "warning" : "danger"}>
                        {r.healthyPct}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
