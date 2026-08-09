import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, Badge, EmptyState, ActionLink } from "@/components/ui";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { MAP_POINT_SELECT, toMapPoints } from "@/lib/map-points";
import { AlertsPanel } from "@/components/manager/AlertsPanel";
import { ManagerInsights } from "@/components/manager/ManagerInsights";
import { AutoRefresh } from "@/components/app/AutoRefresh";
import {
  EVENT_META,
  formatKesCompact,
  formatNumber,
  formatRating,
  formatRelative,
  STATUS_META,
} from "@/lib/format";
import { regionWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Manager dashboard" };

// Always read live data. A cached dashboard is a dashboard that lies.
export const dynamic = "force-dynamic";

export default async function ManagerDashboard() {
  const user = await requireRole("MANAGER", "ADMIN");

  // A manager sees their region. An admin sees everything.
  const scope = regionWhere(user.region, user.role);

  // The alerts panel fetches its own data live on the client, so it is not
  // queried here — the server-rendered snapshot would be stale within seconds.
  const [counts, transformers, recentEvents, claims] = await Promise.all([
    prisma.transformer.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
    }),
    prisma.transformer.findMany({
      where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
      select: MAP_POINT_SELECT,
    }),
    prisma.lifecycleEvent.findMany({
      where: { transformer: scope },
      orderBy: { occurredAt: "desc" },
      take: 12,
      include: {
        user: { select: { name: true } },
        transformer: { select: { id: true, gNumber: true, ratingKva: true, currentSiteName: true } },
      },
    }),
    prisma.warrantyClaim.findMany({
      where: { status: { in: ["OPEN", "SUBMITTED"] }, transformer: scope },
      select: { claimValueKes: true },
    }),
  ]);

  const countOf = (status: string) =>
    counts.find((c) => c.status === status)?._count._all ?? 0;
  const total = counts.reduce((sum, c) => sum + c._count._all, 0);

  // Recoverable money. Decimal comes back as a Prisma Decimal, so coerce it.
  const recoverable = claims.reduce(
    (sum, c) => sum + Number(c.claimValueKes ?? 0),
    0,
  );

  // Under warranty and still in service. Computed in JS rather than SQL because
  // the expiry depends on each unit's own warrantyMonths.
  const inServiceUnits = await prisma.transformer.findMany({
    where: { ...scope, status: { in: ["IN_FIELD", "IN_STORE"] } },
    select: { warrantyStart: true, warrantyMonths: true },
  });
  const underWarranty = inServiceUnits.filter((tx) => {
    if (!tx.warrantyStart) return false;
    const expiry = new Date(tx.warrantyStart);
    expiry.setMonth(expiry.getMonth() + tx.warrantyMonths);
    return expiry.getTime() > Date.now();
  }).length;

  const points: MapPoint[] = toMapPoints(transformers);

  return (
    <div className="space-y-6">
      <AutoRefresh seconds={30} />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">
          {user.region ?? "All regions"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every transformer in your region, and what has happened to it.
        </p>
      </div>

      {/* --- Stats ---------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Total" value={formatNumber(total)} hint="On the register" />
        <StatTile label="In store" value={formatNumber(countOf("IN_STORE"))} tone="info" hint="Ready to dispatch" />
        <StatTile label="In field" value={formatNumber(countOf("IN_FIELD"))} tone="success" hint="Energised" />
        <StatTile label="Faulty" value={formatNumber(countOf("FAULTY"))} tone="danger" hint="Needs action" />
        <StatTile
          label="Recoverable"
          value={formatKesCompact(recoverable)}
          tone="warning"
          hint={`${claims.length} open claim${claims.length === 1 ? "" : "s"}`}
          href="/manager/warranty"
        />
      </div>

      {/* --- KPLC data findings --------------------------------------------- */}
      <KplcFindings region={user.role === "MANAGER" ? user.region : null} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Map ---------------------------------------------------------- */}
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title={`Field map — ${points.length} located`}
            action={
              <Link href="/manager/map" className="text-xs font-bold text-kplc hover:underline">
                Full map →
              </Link>
            }
          />
          <div className="h-[380px]">
            {points.length ? (
              <TransformerMap points={points} height="380px" />
            ) : (
              <EmptyState message="No transformers have a recorded location yet." />
            )}
          </div>
        </Card>

        {/* --- Alerts (live, self-refreshing, acknowledgeable) -------------- */}
        <div id="alerts" className="scroll-mt-20">
          <AlertsPanel />
        </div>
      </div>

      {/* --- Trends, digest, recovered money, warranty calendar, regions --- */}
      <ManagerInsights region={user.role === "MANAGER" ? user.region : null} isAdmin={user.role === "ADMIN"} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Activity ----------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" />
          {recentEvents.length ? (
            <ul className="divide-y divide-line">
              {recentEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-4 px-5 py-3.5">
                  <Badge tone={EVENT_META[event.type].tone}>
                    {EVENT_META[event.type].label}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/transformers/${event.transformer.id}`}
                      className="text-sm font-semibold text-navy hover:text-kplc"
                    >
                      {event.transformer.gNumber} · {formatRating(event.transformer.ratingKva)}
                    </Link>
                    <p className="truncate text-xs text-ink-soft">
                      {event.user.name}
                      {event.locationName ? ` · ${event.locationName}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-soft">
                    {formatRelative(event.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="Nothing has happened yet." />
          )}
        </Card>

        {/* --- Quick links -------------------------------------------------- */}
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy">Quick links</h2>
          <div className="mt-4 grid gap-3">
            <ActionLink href="/kplc-control" variant="gold">Control centre — live</ActionLink>
            <ActionLink href="/manager/map" variant="primary">View full map</ActionLink>
            <ActionLink href="/manager/search" variant="secondary">Search transformers</ActionLink>
            <ActionLink href="/manager/warranty" variant="secondary">Warranty claims</ActionLink>
            <ActionLink href="/manager/manufacturers" variant="secondary">Manufacturer performance</ActionLink>
            <ActionLink href="/manager/reports" variant="secondary">Reports</ActionLink>
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <p className="text-[11px] font-bold tracking-[0.1em] text-ink-soft">
              BY STATUS
            </p>
            <ul className="mt-3 space-y-2">
              {counts.map((row) => (
                <li key={row.status} className="flex items-center justify-between">
                  <Badge tone={STATUS_META[row.status].tone}>
                    {STATUS_META[row.status].label}
                  </Badge>
                  <span className="text-sm font-bold text-navy">
                    {row._count._all}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-ink-soft">
              {formatNumber(underWarranty)} of {formatNumber(total)} still under
              warranty.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * What the two KPLC data sources say, side by side.
 *
 * Deliberately a separate block from the status tiles above: those count where
 * transformers ARE, these count what is WRONG with them. Mixing the two makes
 * a dashboard where nothing stands out.
 */
async function KplcFindings({ region }: { region: string | null }) {
  const scope = region ? { region } : {};

  const [phaseOverload, rottenPoles, openEarths, conflicts, lowIr, staged, inRepair, awaitingReplacement] = await Promise.all([
    prisma.alert.count({ where: { type: "SINGLE_PHASE_OVERLOAD", acknowledged: false, ...(region ? { region } : {}) } }),
    prisma.transformer.count({ where: { ...scope, structureCondition: { in: ["ROTTEN", "LEANING"] } } }),
    prisma.substationInspection.count({
      where: {
        OR: [{ hvEarthState: "OPEN_CIRCUIT" }, { neutralEarthState: "OPEN_CIRCUIT" }],
        ...(region ? { region } : {}),
      },
    }),
    prisma.recordConflict.count({ where: { status: "OPEN" } }),
    prisma.testRecord.count({ where: { stage: "FIELD_DIAGNOSTIC", passed: false } }),
    prisma.substationInspection.count({ where: { transformerId: null } }),
    prisma.transformer.count({ where: { ...scope, status: "AT_WORKSHOP" } }),
    prisma.transformer.count({ where: { ...scope, status: "AWAITING_REPLACEMENT" } }),
  ]);

  const anything = phaseOverload + rottenPoles + openEarths + conflicts + lowIr + staged + inRepair + awaitingReplacement;
  if (!anything) return null;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between px-1">
        <p className="text-xs font-bold tracking-[0.1em] text-ink-soft">FROM KPLC DATA</p>
        <Link href="/manager/priority" className="text-xs font-bold text-kplc hover:underline">
          Repair priority →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="In repair"
          value={formatNumber(inRepair)}
          tone={inRepair ? "warning" : "neutral"}
          hint="on a workshop bench"
          href="/store/workshop"
        />
        <StatTile
          label="Awaiting replacement"
          value={formatNumber(awaitingReplacement)}
          tone={awaitingReplacement ? "danger" : "neutral"}
          hint={awaitingReplacement ? "sites off supply" : "none"}
          href="/store/workshop"
        />
        <StatTile
          label="Phase overload"
          value={formatNumber(phaseOverload)}
          tone={phaseOverload ? "danger" : "neutral"}
          hint="a phase over rating"
          href="/manager/priority?defect=phase"
        />
        <StatTile
          label="Rotten poles"
          value={formatNumber(rottenPoles)}
          tone={rottenPoles ? "danger" : "neutral"}
          hint="rotten or leaning"
          href="/manager/priority?defect=pole"
        />
        <StatTile
          label="Open earths"
          value={formatNumber(openEarths)}
          tone={openEarths ? "danger" : "neutral"}
          hint="tester read over range"
          href="/manager/priority?defect=earth"
        />
        <StatTile
          label="Failed IR/WR"
          value={formatNumber(lowIr)}
          tone={lowIr ? "warning" : "neutral"}
          hint="insulation or winding"
          href="/manager/priority?defect=ir"
        />
        <StatTile
          label="Conflicts"
          value={formatNumber(conflicts)}
          tone={conflicts ? "warning" : "neutral"}
          hint="records disagree"
          href="/manager/conflicts"
        />
        <StatTile
          label="Staged"
          value={formatNumber(staged)}
          tone={staged ? "info" : "neutral"}
          hint="awaiting a transformer"
          href="/manager/staging"
        />
      </div>
    </div>
  );
}
