import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, Badge, EmptyState, ActionLink } from "@/components/ui";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import {
  EVENT_META,
  formatKesCompact,
  formatNumber,
  formatRating,
  formatRelative,
  STATUS_META,
} from "@/lib/format";

export const metadata: Metadata = { title: "Manager dashboard" };

// Always read live data. A cached dashboard is a dashboard that lies.
export const dynamic = "force-dynamic";

export default async function ManagerDashboard() {
  const user = await requireRole("MANAGER", "ADMIN");

  // A manager sees their region. An admin sees everything.
  const scope = user.role === "MANAGER" && user.region ? { region: user.region } : {};

  const [counts, transformers, recentEvents, alerts, claims] = await Promise.all([
    prisma.transformer.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
    }),
    prisma.transformer.findMany({
      where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
      select: {
        id: true, gNumber: true, serialNumber: true, ratingKva: true,
        status: true, currentLat: true, currentLng: true,
        currentSiteName: true, feeder: true,
      },
    }),
    prisma.lifecycleEvent.findMany({
      where: { transformer: scope },
      orderBy: { occurredAt: "desc" },
      take: 10,
      include: {
        user: { select: { name: true } },
        transformer: { select: { id: true, gNumber: true, ratingKva: true, currentSiteName: true } },
      },
    }),
    prisma.alert.findMany({
      where: { acknowledged: false, ...(user.role === "MANAGER" && user.region ? { region: user.region } : {}) },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: { transformer: { select: { id: true, gNumber: true } } },
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

  const points: MapPoint[] = transformers.map((tx) => ({
    id: tx.id,
    gNumber: tx.gNumber,
    serialNumber: tx.serialNumber,
    ratingKva: tx.ratingKva,
    status: tx.status,
    lat: tx.currentLat!,
    lng: tx.currentLng!,
    siteName: tx.currentSiteName,
    feeder: tx.feeder,
  }));

  return (
    <div className="space-y-6">
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

        {/* --- Alerts ------------------------------------------------------- */}
        <Card>
          <CardHeader title={`Alerts (${alerts.length})`} />
          {alerts.length ? (
            <ul className="divide-y divide-line">
              {alerts.map((alert) => (
                <li key={alert.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <Badge tone={alert.severity === "CRITICAL" ? "danger" : "warning"}>
                      {alert.severity}
                    </Badge>
                    <span className="shrink-0 text-[11px] text-ink-soft">
                      {formatRelative(alert.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-snug text-navy">
                    {alert.message}
                  </p>
                  <Link
                    href={`/transformers/${alert.transformerId}`}
                    className="mt-1.5 inline-block text-[11px] font-bold text-kplc hover:underline"
                  >
                    {alert.transformer.gNumber} →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No open alerts." />
          )}
        </Card>
      </div>

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
            <ActionLink href="/manager/map" variant="primary">View full map</ActionLink>
            <ActionLink href="/transformers" variant="secondary">Search transformers</ActionLink>
            <ActionLink href="/manager/warranty" variant="secondary">Warranty claims</ActionLink>
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
