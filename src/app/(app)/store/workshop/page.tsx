import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StatTile } from "@/components/ui";
import { formatKes, formatNumber, formatRelative } from "@/lib/format";
import { regionWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Workshop" };
export const dynamic = "force-dynamic";

/**
 * The workshop floor.
 *
 * Ordered by how long a unit has been sitting, worst first, because the number
 * that matters here is not how many are being repaired — it is how long the
 * oldest one has been waiting. Every day on this bench is a day a site is dark.
 */
export default async function WorkshopPage() {
  const user = await requireRole("STORE_KEEPER", "ADMIN", "MANAGER");
  const scope = regionWhere(user.region, user.role);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [open, completedThisMonth, failedThisMonth, awaiting] = await Promise.all([
    prisma.repairRecord.findMany({
      where: { repairCompletedAt: null, transformer: scope },
      orderBy: { receivedAtWorkshop: "asc" },
      include: {
        transformer: {
          select: {
            id: true, gNumber: true, serialNumber: true, ratingKva: true,
            status: true, currentSiteName: true, repairCount: true,
            manufacturer: { select: { name: true } },
          },
        },
      },
    }),
    prisma.repairRecord.count({
      where: { repairCompletedAt: { gte: monthStart }, repairSuccessful: true, transformer: scope },
    }),
    prisma.repairRecord.count({
      where: { repairCompletedAt: { gte: monthStart }, repairSuccessful: false, transformer: scope },
    }),
    prisma.transformer.count({ where: { ...scope, status: "AWAITING_REPLACEMENT" } }),
  ]);

  const spendThisMonth = await prisma.repairRecord.aggregate({
    where: { repairCompletedAt: { gte: monthStart }, transformer: scope },
    _sum: { repairCostKes: true },
  });

  const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

  // Started means somebody has opened it; queued means it is still in the pile.
  const started = open.filter((r) => r.faultCauseConfirmed != null);
  const queued = open.filter((r) => r.faultCauseConfirmed == null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/store/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
            ← Store
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Workshop</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Transformers off the pole and on a bench. Ordered by how long they have been
            waiting — every day here is a day a site is without supply.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="In repair" value={formatNumber(started.length)} tone={started.length ? "warning" : "neutral"} hint="work under way" />
        <StatTile label="Queue" value={formatNumber(queued.length)} tone={queued.length ? "info" : "neutral"} hint="received, not opened" />
        <StatTile label="Repaired" value={formatNumber(completedThisMonth)} tone="success" hint="this month" />
        <StatTile label="Condemned" value={formatNumber(failedThisMonth)} tone={failedThisMonth ? "danger" : "neutral"} hint="this month" />
        <StatTile
          label="Awaiting replacement"
          value={formatNumber(awaiting)}
          tone={awaiting ? "danger" : "neutral"}
          hint={awaiting ? "sites off supply" : "none"}
          href="/manager/priority"
        />
      </div>

      {spendThisMonth._sum.repairCostKes ? (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs text-ink-soft">
          <strong className="text-navy">{formatKes(spendThisMonth._sum.repairCostKes)}</strong> spent
          on repairs this month.
        </p>
      ) : null}

      {open.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center">
          <p className="text-3xl">🔧</p>
          <p className="mt-3 text-sm font-bold text-navy">The bench is clear</p>
          <p className="mt-1 text-xs text-ink-soft">
            No transformers are currently at a workshop.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
              <tr>
                <th className="px-3 py-2">Transformer</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">Reported fault</th>
                <th className="px-3 py-2">Days on bench</th>
                <th className="px-3 py-2">Repairs</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {open.map((r) => {
                const d = days(r.receivedAtWorkshop);
                const t = r.transformer;
                return (
                  <tr key={r.id} className={d >= 30 ? "bg-red-50/40" : d >= 14 ? "bg-amber-50/40" : undefined}>
                    <td className="px-3 py-2">
                      <Link href={`/transformers/${t.id}`} className="font-bold text-navy hover:text-kplc">
                        {t.gNumber ? `G-${t.gNumber}` : t.serialNumber}
                      </Link>
                      <span className="ml-2 text-ink-soft">
                        {t.manufacturer.name} · {t.ratingKva} kVA
                      </span>
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-ink-soft">
                      {t.currentSiteName ?? "—"}
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-ink-soft">
                      {r.faultCauseReported ?? "not stated"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`font-bold ${d >= 30 ? "text-red-700" : d >= 14 ? "text-amber-700" : "text-navy"}`}>
                        {d}
                      </span>
                      <span className="ml-1 text-ink-soft">
                        ({formatRelative(r.receivedAtWorkshop)})
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {t.repairCount >= 2 ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          {t.repairCount + 1}× ⚠
                        </span>
                      ) : (
                        <span className="text-ink-soft">{t.repairCount + 1}×</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.faultCauseConfirmed ? (
                        <span className="text-amber-700">in progress</span>
                      ) : (
                        <span className="text-ink-soft">queued</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/store/workshop/${r.id}`}
                        className="rounded-lg bg-kplc px-3 py-1.5 text-[11px] font-bold text-white hover:bg-kplc-dark"
                      >
                        Record outcome
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-soft">
        A unit on its third visit to a bench is flagged. Repeated failures are usually telling you
        something about the site — load, earthing, or lightning exposure — that a single repair
        record cannot.
      </p>
    </div>
  );
}
