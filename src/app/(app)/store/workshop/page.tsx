import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StatTile } from "@/components/ui";
import { formatKes, formatNumber, formatRelative } from "@/lib/format";
import { visibleTransformerWhere } from "@/lib/region-scope";
import { listTechnicians, workshopCounts, MAX_CONCURRENT_JOBS } from "@/lib/workshop";

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
  const user = await requireRole("STORE_KEEPER", "STORE_MANAGER", "ADMIN", "MANAGER");
  // A store manager attached to a workshop sees that workshop and nothing else.
  // Everyone else sees their region.
  const scope = visibleTransformerWhere(user);
  const ownWorkshopId = user.role === "STORE_MANAGER" ? user.storeId : null;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [open, completedThisMonth, failedThisMonth, awaiting, counts, technicians] = await Promise.all([
    prisma.repairRecord.findMany({
      where: {
        repairCompletedAt: null,
        transformer: scope,
        ...(ownWorkshopId ? { workshopStoreId: ownWorkshopId } : {}),
      },
      // In-repair first, then the queue, each oldest first. A supervisor
      // scanning this needs to see what is moving before what is waiting.
      orderBy: [{ status: "asc" }, { receivedAtWorkshop: "asc" }],
      include: {
        technician: { select: { id: true, name: true } },
        workshopStore: { select: { id: true, name: true } },
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
    workshopCounts(ownWorkshopId ? { workshopStoreId: ownWorkshopId } : {}),
    listTechnicians(ownWorkshopId),
  ]);

  const spendThisMonth = await prisma.repairRecord.aggregate({
    where: { repairCompletedAt: { gte: monthStart }, transformer: scope },
    _sum: { repairCostKes: true },
  });

  const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

  // Bench state is now a real column set deliberately, not inferred from
  // whether somebody happened to have typed a fault cause yet.
  const started = open.filter((r) => r.status === "IN_REPAIR");
  const queued = open.filter((r) => r.status === "QUEUED");
  const freeTechnicians = technicians.filter((t) => t.available).length;

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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Queue"
          value={formatNumber(counts.queued)}
          tone={counts.queued ? "info" : "neutral"}
          hint={freeTechnicians ? `${freeTechnicians} technician${freeTechnicians === 1 ? "" : "s"} free` : "all technicians busy"}
        />
        <StatTile label="In repair" value={formatNumber(counts.inRepair)} tone={counts.inRepair ? "warning" : "neutral"} hint="work under way" />
        <StatTile label="Repaired" value={formatNumber(counts.repaired)} tone="success" hint="done, awaiting movement" />
        <StatTile label="Beyond repair" value={formatNumber(counts.beyondRepair)} tone={counts.beyondRepair ? "danger" : "neutral"} hint="condemned, awaiting disposal" />
      </div>

      {/* --- Technician workload ------------------------------------------- */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-navy">Technicians</h2>
          <p className="text-xs text-ink-soft">
            One transformer each. A queue is honest; a technician holding four jobs is not.
          </p>
        </div>
        {technicians.length === 0 ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
            No technicians are attached to a workshop yet. A technician is a store keeper whose store
            is a workshop — an admin sets that under Users.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {technicians.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-navy">{t.name}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {t.workshopName ?? "no workshop"}
                  </span>
                </span>
                {t.available ? (
                  <span className="rounded-full bg-kplc/10 px-2.5 py-1 text-[11px] font-bold text-kplc">
                    Free
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900">
                    On {t.currentJob?.label ?? "a job"}
                  </span>
                )}
                <span className="w-16 text-right text-xs text-ink-soft">
                  {t.activeJobs}/{MAX_CONCURRENT_JOBS}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Repaired this month" value={formatNumber(completedThisMonth)} tone="success" hint="throughput" />
        <StatTile label="Condemned this month" value={formatNumber(failedThisMonth)} tone={failedThisMonth ? "danger" : "neutral"} hint="write-offs" />
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
                <th className="px-3 py-2">Technician</th>
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
                      <Link href={`/transformers/${t.id}`} className="inline-flex min-h-11 items-center font-bold text-navy hover:text-kplc">
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
                      {r.technician ? (
                        <span className="font-semibold text-navy">{r.technician.name}</span>
                      ) : (
                        <span className="text-ink-soft">unassigned</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === "IN_REPAIR" ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                          In repair
                        </span>
                      ) : (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">
                          Queued
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/store/workshop/${r.id}`}
                        className="inline-flex min-h-11 items-center rounded-lg bg-kplc px-4 text-[11px] font-bold text-white hover:bg-kplc-dark"
                      >
                        {r.status === "IN_REPAIR" ? "Record outcome" : "Assign / start"}
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
