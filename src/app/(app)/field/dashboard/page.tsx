import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { formatRating, formatRelative } from "@/lib/format";
import {
  IconCamera,
  IconPin,
  IconClipboard,
  IconArrowRight,
} from "@/components/marketing/icons";

export const metadata: Metadata = { title: "My work" };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
/** A unit not inspected in this long goes on the list. */
const INSPECTION_INTERVAL_DAYS = 180;

export default async function FieldDashboard() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");
  const scope = user.region ? { region: user.region } : {};

  const [awaitingReceipt, inField, nearby] = await Promise.all([
    // Dispatched to my region and not yet confirmed on site.
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
      select: {
        id: true, gNumber: true, serialNumber: true, ratingKva: true,
        status: true, currentLat: true, currentLng: true,
        currentSiteName: true, feeder: true,
      },
      take: 60,
    }),
  ]);

  const cutoff = Date.now() - INSPECTION_INTERVAL_DAYS * DAY;
  const inspectionsDue = inField
    .filter((tx) => {
      const last = tx.events[0]?.occurredAt ?? tx.commissionDate;
      return last ? last.getTime() < cutoff : true;
    })
    .sort((a, b) => {
      const at = a.events[0]?.occurredAt?.getTime() ?? 0;
      const bt = b.events[0]?.occurredAt?.getTime() ?? 0;
      return at - bt; // oldest first — most overdue at the top
    });

  const points: MapPoint[] = nearby.map((tx) => ({
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

  const taskCount = awaitingReceipt.length + inspectionsDue.length;

  return (
    <div className="space-y-5">
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
                      <p className="text-sm font-bold text-navy">
                        {tx.gNumber ?? tx.serialNumber}
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

      {/* --- Inspections due ------------------------------------------------ */}
      <Card>
        <CardHeader title={`Inspections due (${inspectionsDue.length})`} />
        {inspectionsDue.length ? (
          <ul className="divide-y divide-line">
            {inspectionsDue.slice(0, 12).map((tx) => {
              const last = tx.events[0]?.occurredAt ?? tx.commissionDate;
              return (
                <li key={tx.id}>
                  <Link
                    href={`/field/${tx.id}/inspect`}
                    className="flex items-center gap-3 px-4 py-4 active:bg-surface"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-kplc/8 text-kplc">
                      <span className="h-4 w-4">
                        <IconPin />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-navy">
                        {tx.currentSiteName ?? tx.gNumber}
                      </span>
                      <span className="block text-xs text-ink-soft">
                        {tx.gNumber} · {formatRating(tx.ratingKva)} · last seen{" "}
                        {last ? formatRelative(last) : "never"}
                      </span>
                    </span>
                    <span className="h-4 w-4 shrink-0 text-ink-soft">
                      <IconArrowRight />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState message="No inspections are overdue in your region." />
        )}
      </Card>

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
