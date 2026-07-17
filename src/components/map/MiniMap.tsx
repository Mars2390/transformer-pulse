"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` on render, so it can only load in the browser.
// ssr:false must live in a client component (Next 15 forbids it in a server one).
const Inner = dynamic(() => import("./MiniMapInner"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-surface-2" />,
});

export function MiniMap(props: { lat: number; lng: number; colour?: string }) {
  return <Inner {...props} />;
}
