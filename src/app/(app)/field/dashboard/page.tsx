import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, EmptyState, Badge, StatTile } from "@/components/ui";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { MAP_POINT_SELECT, toMapPoints } from "@/lib/map-points";
import { AutoRefresh } from "@/components/app/AutoRefresh";
import { formatNumber, formatRating, formatRelative } from "@/lib/format";
import {
  IconCamera,
  IconPin,
  IconPinPlus,
  IconClipboard,
  IconArrowRight,
} from "@/components/marketing/icons";
import { regionWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "My work" };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
/** A unit not inspected in this long is overdue. */
const INSPECTION_INTERVAL_DAYS = 180;
/** From this many days, an inspection is "due soon" — plan-ahead, not overdue. */
const INSPECTION_DUE_SOON_DAYS = 150;

export default async function FieldDashboard() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");
  const scope = regionWhere(user.region, user.role);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [inTransit, inField, nearby, myInstalls, myInspections, myFaults] = await Promise.all([
    // Everything on the way to my region — split below by whether it has been
    // received on site yet.
    prisma.transformer.findMany({
      where: { ...scope, status: "IN_TRANSIT" },
      include: {
        events: { orderBy: { occurredAt: "desc" }, take: 1 },
        manufacturer: { select: { name: true } },
      },
    }),
    prisma.transformer.findMany({
      where: { ...scope, status: "IN_FIELD" },
      select: {
        id: true, gNumber: true, ratingKva: true, currentSiteName: true,
        commissionDate: true,
        // lastInspectionAt carries the register's inspection date for a
        // promoted unit, which has no INSPECTED event of its own. Without it,
        // every one of the 927 promoted transformers shows "Infinityd overdue".
        lastInspectionAt: true,
        events: {
          where: { type: { in: ["INSPECTED", "INSTALLED"] } },
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { occurredAt: true },
        },
      },
    }),
    prisma.transformer.findMany({
      where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
      select: MAP_POINT_SELECT,
      take: 60,
    }),
    // My performance this month.
    prisma.lifecycleEvent.count({ where: { userId: user.id, type: "INSTALLED", occurredAt: { gte: monthStart } } }),
    prisma.lifecycleEvent.count({ where: { userId: user.id, type: "INSPECTED", occurredAt: { gte: monthStart } } }),
    prisma.lifecycleEvent.count({ where: { userId: user.id, type: "FAULT_REPORTED", occurredAt: { gte: monthStart } } }),
  ]);

  // In transit splits two ways by its latest event: not yet received (confirm
  // arrival) versus received but not yet installed (install now).
  const awaitingReceipt = inTransit.filter(
    (tx) => tx.events[0]?.type !== "RECEIVED_BY_FIELD",
  );
  const pendingInstall = inTransit.filter(
    (tx) => tx.events[0]?.type === "RECEIVED_BY_FIELD",
  );

  // Inspections, tiered: "due soon" from 150 days (plan ahead, amber) and
  // "overdue" past 180 (act now, red). Each row carries its day count so the
  // UI can badge it without recomputing.
  const now = Date.now();
  const inspectionsDue = inField
    .map((tx) => {
      // Newest of: a real inspection/install event, the register's inspection
      // date, or the commission date. Whichever we actually know.
      const known = [
        tx.events[0]?.occurredAt,
        tx.lastInspectionAt,
        tx.commissionDate,
      ].filter((d): d is Date => d != null);
      const last = known.length
        ? new Date(Math.max(...known.map((d) => d.getTime())))
        : null;
      // `never` when nothing is on record, so the UI can say so instead of
      // rendering "Infinityd overdue".
      const days = last ? Math.floor((now - last.getTime()) / DAY) : null;
      return { tx, days, overdue: days == null || days >= INSPECTION_INTERVAL_DAYS };
    })
    .filter(({ days }) => days == null || days >= INSPECTION_DUE_SOON_DAYS)
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity)); // never-inspected first

  const points: MapPoint[] = toMapPoints(nearby);

  const taskCount =
    awaitingReceipt.length + pendingInstall.length + inspectionsDue.length;

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">
          My work
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {user.region ?? "All regions"} ·{" "}
          {taskCount === 0
            ? "Nothing outstanding"
            : `${taskCount} task${taskCount === 1 ? "" : "s"}`}
        </p>
      </div>

      {/* --- Primary action -------------------------------------------------
          One big target at the top. On a phone, in the field, the most common
          action must never require aiming. */}
      <Link
        href="/field/scan"
        className="flex items-center gap-4 rounded-2xl bg-kplc p-5 text-white shadow-lg shadow-kplc/25 transition-transform active:scale-[0.98]"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15">
          <span className="h-6 w-6">
            <IconCamera />
          </span>
        </span>
        <span className="flex-1">
          <span className="block text-base font-bold">Submit a reading</span>
          <span className="block text-[13px] text-white/70">
            Photo, GPS and test values from where you stand
          </span>
        </span>
        <span className="h-5 w-5 shrink-0 text-white/60">
          <IconArrowRight />
        </span>
      </Link>

      {/* --- Onboard an existing transformer ---------------------------------
          Second only to submitting a reading. A field engineer walks past units
          this system has never heard of all day; before this they had nowhere
          to put them and had to ask a store keeper to add one from a desk. */}
      <Link
        href="/field/onboard"
        className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4 transition-transform active:scale-[0.99]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-kplc/10 text-kplc">
          <span className="h-5 w-5">
            <IconPinPlus />
          </span>
        </span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-navy">📍 Onboard existing transformer</span>
          <span className="block text-[13px] text-ink-soft">
            One you found in the field that is not in the system yet
          </span>
        </span>
        <span className="h-5 w-5 shrink-0 text-ink-soft">
          <IconArrowRight />
        </span>
      </Link>

      {/* --- Awaiting receipt ------------------------------------------------ */}
      {awaitingReceipt.length > 0 && (
        <Card>
          <CardHeader title={`Arriving — confirm receipt (${awaitingReceipt.length})`} />
          <ul className="divide-y divide-line">
            {awaitingReceipt.map((tx) => {
              const dispatch = tx.events[0];
              return (
                <li key={tx.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-bold text-navy">
                        {tx.gNumber ?? tx.serialNumber}
                        {dispatch && Date.now() - dispatch.occurredAt.getTime() < DAY && (
                          <span className="rounded-full bg-kplc px-2 py-0.5 text-[10px] font-bold text-white">NEW</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {formatRating(tx.ratingKva)} · {tx.manufacturer.name}
                      </p>
                      {dispatch?.destination && (
                        <p className="mt-1 text-xs text-ink-soft">
                          To {dispatch.destination}
                          {dispatch.vehiclePlate ? ` · ${dispatch.vehiclePlate}` : ""}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-ink-soft">
                      {dispatch ? formatRelative(dispatch.occurredAt) : ""}
                    </span>
                  </div>
                  <Link
                    href={`/field/${tx.id}/receive`}
                    className="mt-3 block rounded-xl bg-gold py-3 text-center text-sm font-bold text-navy-dark active:scale-[0.98]"
                  >
                    Confirm it arrived
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* --- Pending installations ------------------------------------------ */}
      {pendingInstall.length > 0 && (
        <Card>
          <CardHeader title={`Received — install now (${pendingInstall.length})`} />
          <ul className="divide-y divide-line">
            {pendingInstall.map((tx) => (
              <li key={tx.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-navy">{tx.gNumber ?? tx.serialNumber}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {formatRating(tx.ratingKva)} · {tx.manufacturer.name}
                      {tx.events[0]?.destination ? ` · ${tx.events[0].destination}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-soft">
                    {tx.events[0] ? formatRelative(tx.events[0].occurredAt) : ""}
                  </span>
                </div>
                <Link
                  href={`/field/${tx.id}/install`}
                  className="mt-3 block rounded-xl bg-kplc py-3 text-center text-sm font-bold text-white active:scale-[0.98]"
                >
                  Install now
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* --- Inspections due ------------------------------------------------ */}
      <Card>
        <CardHeader title={`Inspections due (${inspectionsDue.length})`} />
        {inspectionsDue.length ? (
          <ul className="divide-y divide-line">
            {inspectionsDue.slice(0, 15).map(({ tx, days, overdue }) => (
              <li key={tx.id}>
                <Link
                  href={`/field/${tx.id}/inspect`}
                  className="flex items-center gap-3 px-4 py-4 active:bg-surface"
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${overdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                    <span className="h-4 w-4">
                      <IconPin />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-navy">
                      {tx.currentSiteName ?? tx.gNumber}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {tx.gNumber} · {formatRating(tx.ratingKva)}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <Badge tone={overdue ? "danger" : "warning"}>
                      {days == null
                        ? "Never inspected"
                        : overdue
                          ? `${days}d overdue`
                          : `due in ${INSPECTION_INTERVAL_DAYS - days}d`}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="No inspections are due in your region." />
        )}
      </Card>

      {/* --- My performance this month -------------------------------------- */}
      <div>
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-bold tracking-[0.1em] text-ink-soft">MY PERFORMANCE THIS MONTH</p>
          <div className="flex gap-2">
            <a href="/api/reports/engineer-performance?format=csv" className="text-[11px] font-bold text-kplc hover:underline">Export mine</a>
            <a href="/api/reports/locations" className="text-[11px] font-bold text-kplc hover:underline">Locations CSV</a>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Installed" value={formatNumber(myInstalls)} tone="success" />
          <StatTile label="Inspected" value={formatNumber(myInspections)} tone="info" />
          <StatTile label="Faults" value={formatNumber(myFaults)} tone={myFaults ? "warning" : "neutral"} />
        </div>
      </div>

      {/* --- Map ------------------------------------------------------------ */}
      <Card className="overflow-hidden">
        <CardHeader
          title={`Near me (${points.length})`}
          action={
            <Link href="/field/map" className="text-xs font-bold text-kplc hover:underline">
              Full map →
            </Link>
          }
        />
        <div className="h-[300px]">
          {points.length ? (
            <TransformerMap points={points} height="300px" zoom={11} />
          ) : (
            <EmptyState message="No located transformers in your region." />
          )}
        </div>
      </Card>

      <Link
        href="/transformers"
        className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 active:scale-[0.99]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-navy">
          <span className="h-4 w-4">
            <IconClipboard />
          </span>
        </span>
        <span className="flex-1 text-sm font-bold text-navy">
          Look up any transformer
        </span>
        <span className="h-4 w-4 shrink-0 text-ink-soft">
          <IconArrowRight />
        </span>
      </Link>
    </div>
  );
}
