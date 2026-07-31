"use client";

import { useState } from "react";
import Image from "next/image";
import { MiniMap } from "@/components/map/MiniMap";
import { Badge } from "@/components/ui";
import { Lightbox, type LightboxPhoto } from "./Lightbox";
import type { StoryEvent } from "./story-types";
import type { RepairView } from "./RepairsTab";
import { formatKes } from "@/lib/format";
import {
  EVENT_META,
  ROLE_LABELS,
  formatDateTime,
  formatPlate,
  formatRelative,
} from "@/lib/format";

const EVENT_DOT: Record<string, string> = {
  info: "#1e40af",
  success: "#0e8a4f",
  warning: "#d99e00",
  danger: "#c02626",
  neutral: "#7b8383",
};

/**
 * The story, newest event first, with the genesis anchored at the bottom.
 *
 * Newest-first is the operational truth: the person opening this wants to know
 * what happened LAST. "Start of story" sits at the very bottom so the whole
 * life reads as one thread from birth to now.
 */
export function Timeline({
  events,
  year = "ALL",
  compareYear = null,
  repairs = [],
}: {
  events: StoryEvent[];
  year?: number | "ALL";
  compareYear?: number | null;
  repairs?: RepairView[];
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const shown = year === "ALL" ? events : events.filter((e) => new Date(e.occurredAt).getFullYear() === year);

  // A flat list of every photo across every SHOWN event, for the lightbox to
  // page through — with a caption that says which event it came from.
  const allPhotos: LightboxPhoto[] = [];
  const photoIndexByUrl = new Map<string, number>();
  for (const event of shown) {
    for (const url of event.photoUrls) {
      photoIndexByUrl.set(url, allPhotos.length);
      allPhotos.push({
        url,
        caption: `${EVENT_META[event.type].label} · ${formatDateTime(event.occurredAt)}`,
      });
    }
  }

  return (
    <div className="relative">
      {/* --- Year summary ---------------------------------------------------- */}
      {year !== "ALL" && (
        <div className="mb-5 rounded-xl border border-line bg-surface-2 px-4 py-3">
          {compareYear != null ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <YearSummaryLine year={year} events={events} repairs={repairs} />
              <YearSummaryLine year={compareYear} events={events} repairs={repairs} />
            </div>
          ) : (
            <YearSummaryLine year={year} events={events} repairs={repairs} />
          )}
        </div>
      )}

      {/* The spine. */}
      <div className="absolute bottom-4 left-[19px] top-4 w-px bg-line sm:left-[23px]" aria-hidden="true" />

      <ol className="space-y-5">
        {shown.map((event) => {
          const meta = EVENT_META[event.type];
          const dot = EVENT_DOT[meta.tone] ?? EVENT_DOT.neutral;

          // The gap between "when it happened" and "when the server heard about
          // it" — the honest record of an event captured offline in the field.
          const recordedLater =
            new Date(event.createdAt).getTime() - new Date(event.occurredAt).getTime() >
            60 * 60 * 1000;

          return (
            <li key={event.id} className="relative flex gap-4">
              <span
                className="relative z-10 mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border-4 border-surface sm:h-12 sm:w-12"
                style={{ backgroundColor: dot }}
              >
                <span className="text-[10px] font-bold text-white sm:text-xs">
                  {meta.label.split(" ")[0].slice(0, 4).toUpperCase()}
                </span>
              </span>

              <div className="min-w-0 flex-1 rounded-2xl border border-line bg-white p-4 shadow-sm shadow-navy/4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <p className="mt-1.5 text-sm font-semibold text-navy">
                      {event.userName}
                      <span className="font-normal text-ink-soft">
                        {" "}· {ROLE_LABELS[event.userRole as keyof typeof ROLE_LABELS] ?? event.userRole}
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-navy">
                      {formatDateTime(event.occurredAt)}
                    </p>
                    <p className="text-[11px] text-ink-soft">
                      {formatRelative(event.occurredAt)}
                    </p>
                  </div>
                </div>

                {recordedLater && (
                  <p className="mt-2 inline-block rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    Recorded {formatRelative(event.createdAt).replace(" ago", " later")} — captured offline in the field
                  </p>
                )}

                {event.notes && (
                  <p className="mt-2.5 text-[13px] leading-relaxed text-navy">
                    {event.notes}
                  </p>
                )}

                {/* Movement details */}
                {(event.vehiclePlate || event.destination) && (
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                    {event.vehiclePlate && (
                      <span>
                        Vehicle{" "}
                        <span className="font-mono font-semibold text-navy">
                          {formatPlate(event.vehiclePlate)}
                        </span>
                      </span>
                    )}
                    {event.driverName && <span>Driver {event.driverName}</span>}
                    {event.destination && <span>To {event.destination}</span>}
                  </div>
                )}

                {/* Test summary */}
                {event.test && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
                    <Badge tone={event.test.passed ? "success" : "danger"}>
                      Test {event.test.passed ? "passed" : "failed"}
                    </Badge>
                    {event.test.oilBdvKv != null && (
                      <span className="text-ink-soft">Oil BDV {event.test.oilBdvKv} kV</span>
                    )}
                    {event.test.insulationResistanceHvMohm != null && (
                      <span className="text-ink-soft">
                        IR HV {event.test.insulationResistanceHvMohm} MΩ
                      </span>
                    )}
                  </div>
                )}

                {/* Photos */}
                {event.photoUrls.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {event.photoUrls.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setLightbox(photoIndexByUrl.get(url) ?? 0)}
                        className="relative h-16 w-16 overflow-hidden rounded-lg border border-line transition-transform hover:scale-105"
                      >
                        <Image src={url} alt="" fill sizes="64px" unoptimized className="object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Location + mini map */}
                {event.lat != null && event.lng != null && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-line">
                    <div className="h-32 w-full">
                      <MiniMap lat={event.lat} lng={event.lng} colour={dot} />
                    </div>
                    <p className="bg-surface px-3 py-1.5 font-mono text-[11px] text-ink-soft">
                      {event.lat.toFixed(5)}, {event.lng.toFixed(5)}
                      {event.accuracyM != null && ` · ±${Math.round(event.accuracyM)} m`}
                      {event.locationName && ` · ${event.locationName}`}
                    </p>
                  </div>
                )}

                {/* Hash — the fingerprint of this link in the chain */}
                <p className="mt-3 border-t border-line pt-2 font-mono text-[10px] text-ink-soft/70">
                  {event.prevHash ? `…${event.prevHash.slice(-8)} → ` : "genesis → "}
                  <span className="font-bold text-ink-soft">…{event.hash.slice(-8)}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Genesis anchor */}
      <div className="relative mt-5 flex gap-4">
        <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border-4 border-surface bg-ink-soft sm:h-12 sm:w-12">
          <span className="text-[9px] font-bold text-white">START</span>
        </span>
        <p className="self-center text-xs text-ink-soft">
          Start of story — this transformer entered the system here.
        </p>
      </div>

      <Lightbox
        photos={allPhotos}
        index={lightbox}
        onClose={() => setLightbox(null)}
        onNavigate={setLightbox}
      />
    </div>
  );
}

/** "2025: 2 inspections, 1 load check, 1 fault reported, KES 0 in repairs" */
function YearSummaryLine({ year, events, repairs }: { year: number; events: StoryEvent[]; repairs: RepairView[] }) {
  const yearEvents = events.filter((e) => new Date(e.occurredAt).getFullYear() === year);
  const inspections = yearEvents.filter((e) => e.type === "INSPECTED").length;
  const loadChecks = yearEvents.filter((e) => e.type === "LOAD_CHECK_RECORDED").length;
  const faults = yearEvents.filter((e) => e.type === "FAULT_REPORTED").length;
  const repairCost = repairs
    .filter((r) => new Date(r.receivedAtWorkshop).getFullYear() === year)
    .reduce((s, r) => s + (r.repairCostKes ?? 0), 0);

  return (
    <p className="text-xs font-semibold text-navy">
      <span className="font-extrabold">{year}:</span>{" "}
      {yearEvents.length} event{yearEvents.length === 1 ? "" : "s"} · {inspections} inspection{inspections === 1 ? "" : "s"},{" "}
      {loadChecks} load check{loadChecks === 1 ? "" : "s"}, {faults} fault{faults === 1 ? "" : "s"} reported,{" "}
      {formatKes(repairCost)} in repairs
    </p>
  );
}
