"use client";

import dynamic from "next/dynamic";
import type { ExistingPin } from "./OnboardMapInner";

/**
 * Browser-only wrapper. Same reason as TransformerMap: Leaflet touches
 * `window` on render, and `ssr: false` is only legal inside a client component.
 */
const Inner = dynamic(() => import("./OnboardMapInner"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface-2">
      <p className="text-sm text-ink-soft">Loading map…</p>
    </div>
  ),
});

export function OnboardMap(props: {
  pin: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  existing: ExistingPin[];
}) {
  return <Inner {...props} />;
}

export type { ExistingPin };
