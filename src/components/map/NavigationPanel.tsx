"use client";

import { useEffect, useState } from "react";
import { CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { fetchRoute, type RouteResult } from "@/lib/routing-client";

export type NavTarget = { lat: number; lng: number; label: string; subtitle?: string | null };

type Phase = "locating" | "need-input" | "searching" | "routing" | "ready";

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/**
 * In-map, Bolt/Uber-style navigation: real road routing via our OpenRouteService
 * proxy (turn-by-turn, road-following polyline), with a transparent straight-line
 * fallback the moment the routing API is unavailable or rate-limited. Nothing
 * here calls out to Google Maps; the whole thing lives on this Leaflet instance.
 */
export function NavigationPanel({
  target,
  onClose,
  onSatellite,
}: {
  target: NavTarget;
  onClose: () => void;
  onSatellite?: () => void;
}) {
  const map = useMap();
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("locating");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);

  async function routeFrom(o: { lat: number; lng: number }, force = false) {
    setPhase("routing");
    const outcome = await fetchRoute(o, { lat: target.lat, lng: target.lng }, { force });
    setRoute(outcome.route);
    setRouteError(outcome.error);
    setPhase("ready");
    const bounds = L.latLngBounds(outcome.route.path.length > 1 ? outcome.route.path : [[o.lat, o.lng], [target.lat, target.lng]]);
    map.flyToBounds(bounds, { padding: [48, 48] });
  }

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPhase("need-input");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOrigin(o);
        void routeFrom(o);
      },
      () => setPhase("need-input"),
      { enableHighAccuracy: true, timeout: 8000 },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    );
  }, [target.lat, target.lng]);

  async function searchOrigin(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setPhase("searching");
    setSearchError(null);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", `${q}, Kenya`);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const hits = (await res.json()) as { lat: string; lon: string }[];
      if (!hits.length) {
        setSearchError(`Nothing found for "${q}".`);
        setPhase("need-input");
        return;
      }
      const o = { lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
      setOrigin(o);
      await routeFrom(o);
    } catch {
      setSearchError("Search is unavailable right now — try again.");
      setPhase("need-input");
    }
  }

  async function retry() {
    if (!origin) return;
    setRetrying(true);
    await routeFrom(origin, true);
    setRetrying(false);
  }

  const visibleSteps = route && expanded ? route.steps : route?.steps.slice(0, 4) ?? [];
  const roadRoute = route?.source === "road";

  return (
    <>
      {origin && (
        <CircleMarker
          center={[origin.lat, origin.lng]}
          radius={9}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#0e8a4f", fillOpacity: 0.95 }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]}>Start</Tooltip>
        </CircleMarker>
      )}

      {route && (
        <Polyline
          positions={route.path}
          pathOptions={
            roadRoute
              ? { color: "#2563eb", weight: 5, opacity: 0.9 }
              : { color: "#2563eb", weight: 4, opacity: 0.7, dashArray: "2 10" }
          }
        >
          <Tooltip
            permanent
            direction="center"
            className="!rounded-full !border-0 !bg-[#2563eb] !px-2 !py-0.5 !text-[10px] !font-bold !text-white !shadow-md"
          >
            {route.distanceKm.toFixed(1)} km
          </Tooltip>
        </Polyline>
      )}

      <CircleMarker
        center={[target.lat, target.lng]}
        radius={9}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#c02626", fillOpacity: 0.95 }}
      >
        <Tooltip permanent direction="top" offset={[0, -8]}>{target.label}</Tooltip>
      </CircleMarker>

      <div className="leaflet-bottom leaflet-left">
        <div className="leaflet-control m-3 flex max-h-[70vh] w-[min(92vw,320px)] flex-col overflow-hidden rounded-2xl border border-line bg-white/97 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-extrabold tracking-[0.04em] text-[#0a1a4f]">
                📍 NAVIGATION TO {target.label}
              </p>
              {target.subtitle && (
                <p className="truncate text-[10px] text-[#5b6480]">{target.subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold text-[#5b6480] hover:bg-black/5"
              aria-label="Close navigation"
            >
              ✕
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3">
            {(phase === "locating" || phase === "routing") && (
              <p className="text-xs text-[#5b6480]">
                {phase === "locating" ? "Finding your location…" : "Calculating route…"}
              </p>
            )}

            {phase === "ready" && route && (
              <>
                <div className={`rounded-xl px-3 py-2.5 ${roadRoute ? "bg-[#eff6ff]" : "bg-amber-50"}`}>
                  <p className={`text-sm font-extrabold ${roadRoute ? "text-[#1d4ed8]" : "text-amber-800"}`}>
                    🚗 {route.distanceKm.toFixed(1)} km · ⏱️ {Math.round(route.durationMin)} minutes
                  </p>
                  {!roadRoute && (
                    <>
                      <p className="mt-1 text-[10px] leading-snug text-amber-800">
                        ~{route.distanceKm.toFixed(1)} km estimated — road routing unavailable
                        {routeError ? ` (${routeError})` : ""}.
                      </p>
                      <button
                        onClick={retry}
                        disabled={retrying}
                        className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                      >
                        {retrying ? "Retrying…" : "Try again"}
                      </button>
                    </>
                  )}
                </div>

                {roadRoute && route.steps.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] font-extrabold tracking-[0.08em] text-[#5b6480]">TURN-BY-TURN</p>
                    <ol className="mt-1.5 space-y-1.5">
                      {visibleSteps.map((s, i) => (
                        <li key={i} className="flex gap-2 text-[11px] leading-snug text-[#1c1f1f]">
                          <span className="shrink-0 font-bold text-[#2563eb]">{i + 1}.</span>
                          <span>
                            {s.instruction}
                            {s.distanceM > 0 ? ` (${fmtDist(s.distanceM)})` : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {route.steps.length > 4 && (
                      <button
                        onClick={() => setExpanded((v) => !v)}
                        className="mt-2 text-[10px] font-bold text-[#2563eb] underline"
                      >
                        {expanded ? "Show less" : `Show all ${route.steps.length} steps`}
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
                  {onSatellite && (
                    <button
                      onClick={onSatellite}
                      className="flex-1 rounded-lg border border-[#e3e6ec] px-2 py-2 text-[11px] font-bold text-[#0a1a4f]"
                    >
                      🛰️ Satellite View
                    </button>
                  )}
                  {roadRoute && route.steps.length > 4 && (
                    <button
                      onClick={() => setExpanded((v) => !v)}
                      className="flex-1 rounded-lg border border-[#e3e6ec] px-2 py-2 text-[11px] font-bold text-[#0a1a4f]"
                    >
                      📋 {expanded ? "Less" : "View Details"}
                    </button>
                  )}
                </div>

                <button
                  onClick={() => { setOrigin(null); setRoute(null); setPhase("need-input"); }}
                  className="mt-2 text-[10px] font-bold text-[#5b6480] underline"
                >
                  Use a different starting point
                </button>
              </>
            )}

            {phase === "need-input" && (
              <div>
                <p className="text-xs text-[#5b6480]">
                  {searchError ?? "Location wasn't shared. Enter a starting point instead."}
                </p>
                <form onSubmit={searchOrigin} className="mt-2 flex gap-1.5">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Enter starting location…"
                    className="min-w-0 flex-1 rounded-lg border border-[#e3e6ec] px-2 py-2 text-xs outline-none focus:border-[#0e8a4f]"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg bg-[#0a1a4f] px-3 py-2 text-xs font-bold text-white"
                  >
                    Go
                  </button>
                </form>
              </div>
            )}

            {phase === "searching" && <p className="text-xs text-[#5b6480]">Searching…</p>}
          </div>
        </div>
      </div>
    </>
  );
}
