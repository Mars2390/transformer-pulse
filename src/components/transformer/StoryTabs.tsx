"use client";

import { useState } from "react";
import { Timeline } from "./Timeline";
import { TestsTab } from "./TestsTab";
import { PhotosTab } from "./PhotosTab";
import { WarrantyTab, type WarrantyView } from "./WarrantyTab";
import { ChainTab } from "./ChainTab";
import type { StoryData, StoryTest } from "./story-types";

type Verification = {
  valid: boolean;
  checked: number;
  brokenAtEventId: string | null;
  reason: string | null;
};

const TABS = ["Timeline", "Tests", "Photos", "Warranty", "Chain"] as const;
type Tab = (typeof TABS)[number];

export function StoryTabs({
  story,
  tests,
  warranty,
  verification,
}: {
  story: StoryData;
  tests: StoryTest[];
  warranty: WarrantyView;
  verification: Verification;
}) {
  const [tab, setTab] = useState<Tab>("Timeline");

  const photoCount = story.events.reduce((sum, e) => sum + e.photoUrls.length, 0);
  const counts: Record<Tab, number | null> = {
    Timeline: story.events.length,
    Tests: tests.length,
    Photos: photoCount,
    Warranty: story.claims.length || null,
    Chain: verification.checked,
  };

  return (
    <div>
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
      {tab === "Timeline" && <Timeline events={story.events} />}
      {tab === "Tests" && <TestsTab tests={tests} />}
      {tab === "Photos" && <PhotosTab events={story.events} />}
      {tab === "Warranty" && <WarrantyTab warranty={warranty} claims={story.claims} />}
      {tab === "Chain" && (
        <ChainTab transformerId={story.id} events={story.events} initial={verification} />
      )}
    </div>
  );
}
