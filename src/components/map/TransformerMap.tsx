"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "./TransformerMapInner";

/**
 * Loads the map only in the browser.
 *
 * Leaflet reaches for `window` the moment it renders, so server-rendering it
 * throws. `ssr: false` is the fix — and it must live in a client component,
 * because Next 15 forbids `ssr: false` inside a server component. That is the
 * only reason this thin wrapper file exists.
 */
const Inner = dynamic(() => import("./TransformerMapInner"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-surface-2">
      <p className="text-sm text-ink-soft">Loading map…</p>
    </div>
  ),
});

export function TransformerMap(props: {
  points: MapPoint[];
  height?: string;
  zoom?: number;
}) {
  return <Inner {...props} />;
}

export type { MapPoint };
