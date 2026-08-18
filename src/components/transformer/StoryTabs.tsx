"use client";

import { useMemo, useState } from "react";
import { Timeline } from "./Timeline";
import { TestsTab } from "./TestsTab";
import { PhotosTab } from "./PhotosTab";
import { WarrantyTab, type WarrantyView } from "./WarrantyTab";
import { ChainTab } from "./ChainTab";
import { RepairsTab, type RepairView } from "./RepairsTab";
import { DataTimelineTab } from "./DataTimelineTab";
import type { TimelineEntry, EmdisTrend, InspectionTrend } from "@/lib/data-timeline";
import type { StoryData, StoryTest } from "./story-types";

type Verification = {
  valid: boolean;
  checked: number;
  brokenAtEventId: string | null;
  reason: string | null;
};

const TABS = ["Timeline", "Data Timeline", "Tests", "Repairs", "Photos", "Warranty", "Chain"] as const;
type Tab = (typeof TABS)[number];

export function StoryTabs({
  story,
  tests,
  warranty,
  verification,
  repairs,
  ratingKva,
  repairCount,
  dataTimeline,
  trend,
  inspectionTrend,
}: {
  story: StoryData;
  tests: StoryTest[];
  warranty: WarrantyView;
  verification: Verification;
  repairs: RepairView[];
  ratingKva: number;
  repairCount: number;
  dataTimeline: TimelineEntry[];
  trend: EmdisTrend;
  inspectionTrend: InspectionTrend;
}) {
  const [tab, setTab] = useState<Tab>("Timeline");
  const [year, setYear] = useState<number | "ALL">("ALL");
  const [compare, setCompare] = useState(false);

  const photoCount = story.events.reduce((sum, e) => sum + e.photoUrls.length, 0);
  const counts: Record<Tab, number | null> = {
    Timeline: story.events.length,
    "Data Timeline": dataTimeline.length || null,
    Tests: tests.length,
    Repairs: repairs.length || null,
    Photos: photoCount,
    Warranty: story.claims.length || null,
    Chain: verification.checked,
  };

  // Years actually present in this transformer's history, newest first.
  const years = useMemo(() => {
    const set = new Set(story.events.map((e) => new Date(e.occurredAt).getFullYear()));
    return [...set].sort((a, b) => b - a);
  }, [story.events]);

  const yearFilterable = tab === "Timeline" || tab === "Tests";
  const compareYear = typeof year === "number" ? year - 1 : null;

  return (
    <div>
      {/* --- Year filter ---------------------------------------------------- */}
      {yearFilterable && years.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-ink-soft">View Year:</span>
          <button
            onClick={() => { setYear("ALL"); setCompare(false); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${year === "ALL" ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"}`}
          >
            All Years
          </button>
          {years.map((y) => (
            <button
              key={y}
              onClick={() => { setYear(y); setCompare(false); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${year === y ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"}`}
            >
              {y}
            </button>
          ))}
          {typeof year === "number" && years.includes(compareYear!) && (
            <button
              onClick={() => setCompare((v) => !v)}
              className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-bold ${compare ? "bg-kplc text-white" : "border border-kplc/40 bg-white text-kplc"}`}
            >
              {compare ? `Comparing with ${compareYear}` : `Compare with ${compareYear}`}
            </button>
          )}
        </div>
      )}

      {/* --- Tab bar ------------------------------------------------------ */}
      <div className="sticky top-16 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 sm:mx-0 sm:px-0">
        {TABS.map((name) => {
          const active = tab === name;
          const broken = name === "Chain" && !verification.valid;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`relative shrink-0 px-4 py-3 text-sm font-semibold transition-colors ${
                active ? "text-kplc" : "text-ink-soft hover:text-navy"
              }`}
            >
              {name}
              {counts[name] != null && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    broken
                      ? "bg-red-100 text-red-700"
                      : active
                        ? "bg-kplc/10 text-kplc"
                        : "bg-surface-2 text-ink-soft"
                  }`}
                >
                  {broken ? "!" : counts[name]}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-kplc" />
              )}
            </button>
          );
        })}
      </div>

      {/* --- Panels ------------------------------------------------------- */}
      {tab === "Timeline" && (
        <Timeline events={story.events} year={year} compareYear={compare ? compareYear : null} repairs={repairs} />
      )}
      {tab === "Data Timeline" && (
        <DataTimelineTab entries={dataTimeline} trend={trend} inspectionTrend={inspectionTrend} />
      )}

      {tab === "Tests" && <TestsTab tests={tests} year={year} compareYear={compare ? compareYear : null} />}
      {tab === "Repairs" && (
        <RepairsTab repairs={repairs} ratingKva={ratingKva} repairCount={repairCount} />
      )}
      {tab === "Photos" && <PhotosTab events={story.events} />}
      {tab === "Warranty" && <WarrantyTab warranty={warranty} claims={story.claims} />}
      {tab === "Chain" && (
        <ChainTab transformerId={story.id} events={story.events} initial={verification} />
      )}
    </div>
  );
}
