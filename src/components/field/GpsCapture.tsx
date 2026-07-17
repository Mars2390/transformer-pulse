"use client";

import { MiniMap } from "@/components/map/MiniMap";
import type { GpsState } from "@/lib/useGeolocation";

/**
 * Shows GPS status with a colour that means something: green under 20 m, amber
 * 20–50 m, red beyond. The colour is the whole point — an engineer glances,
 * sees green, and trusts the pin without reading a number.
 */
export function GpsCapture({
  state,
  onRetry,
  required,
}: {
  state: GpsState;
  onRetry: () => void;
  required?: boolean;
}) {
  if (state.status === "ready") {
    const tone =
      state.accuracyM <= 20
        ? { dot: "#0e8a4f", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", label: "Good fix" }
        : state.accuracyM <= 50
          ? { dot: "#d99e00", text: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Acceptable" }
          : { dot: "#c02626", text: "text-red-700", bg: "bg-red-50 border-red-200", label: "Weak — move to open sky" };

    return (
      <div className={`rounded-xl border ${tone.bg} p-3`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone.dot }} />
            <span className={`text-sm font-bold ${tone.text}`}>
              {tone.label} · ±{Math.round(state.accuracyM)} m
            </span>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-bold text-kplc underline"
          >
            Retry
          </button>
        </div>
        <p className="mt-1 font-mono text-xs text-ink-soft">
          {state.lat.toFixed(5)}, {state.lng.toFixed(5)}
        </p>
        <div className="mt-2 h-28 overflow-hidden rounded-lg border border-white/40">
          <MiniMap lat={state.lat} lng={state.lng} colour={tone.dot} />
        </div>
      </div>
    );
  }

  const shell = "rounded-xl border border-line bg-white p-3";

  if (state.status === "locating" || state.status === "idle") {
    return (
      <div className={shell}>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-kplc" />
          <span className="text-sm font-medium text-ink-soft">Getting your location…</span>
        </div>
      </div>
    );
  }

  const messages: Record<string, string> = {
    denied:
      "Location permission is blocked. Enable it for this site in your browser settings, then retry.",
    out_of_bounds:
      "That location is outside Kenya — usually a GPS glitch. Move to open sky and retry.",
    unavailable: "message" in state ? state.message : "Location is unavailable.",
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-800">
        {messages[state.status]}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white"
      >
        Retry location
      </button>
      {required && (
        <p className="mt-2 text-xs text-amber-700">
          This action needs a location before it can be submitted.
        </p>
      )}
    </div>
  );
}
