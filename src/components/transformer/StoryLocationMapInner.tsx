"use client";

import { useState } from "react";
import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { fetchRoute, type RouteResult } from "@/lib/routing-client";

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

/**
 * The story page's own small map + navigate panel. Deliberately self-contained
 * rather than a link off to /field/map or /manager/map — a viewer of this page
 * can be any role, and the mini map should not have to guess which full map
 * they are allowed to open. Distance/time are shown as plain text under the
 * map rather than drawn as an overlay control, because 300x200 has no room for
 * a floating panel; the road route itself is not drawn here for the same
 * reason — see the full map for the turn-by-turn view.
 */
export default function StoryLocationMapInner({
  lat,
  lng,
  colour = "#1e40af",
}: {
  lat: number;
  lng: number;
  colour?: string;
}) {
  const [satellite, setSatellite] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "routing" | "need-input" | "searching" | "ready">("idle");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function routeFrom(o: { lat: number; lng: number }, force = false) {
    setStatus("routing");
    const outcome = await fetchRoute(o, { lat, lng }, { force });
    setRoute(outcome.route);
    setRouteError(outcome.error);
    setStatus("ready");
  }

  function locate() {
    setNavOpen(true);
    setError(null);
    if (!("geolocation" in navigator)) {
      setStatus("need-input");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOrigin(o);
        void routeFrom(o);
      },
      () => setStatus("need-input"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function searchOrigin(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setStatus("searching");
    setError(null);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", `${q}, Kenya`);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const hits = (await res.json()) as { lat: string; lon: string }[];
      if (!hits.length) {
        setError(`Nothing found for "${q}".`);
        setStatus("need-input");
        return;
      }
      const o = { lat: Number(hits[0].lat), lng: Number(hits[0].lon) };
      setOrigin(o);
      await routeFrom(o);
    } catch {
      setError("Search is unavailable right now — try again.");
      setStatus("need-input");
    }
  }

  async function retry() {
    if (!origin) return;
    setRetrying(true);
    await routeFrom(origin, true);
    setRetrying(false);
  }

  const roadRoute = route?.source === "road";

  return (
    <div>
      <div className="relative h-[200px] w-[300px] max-w-full overflow-hidden rounded-xl border border-line">
        <MapContainer
          center={[lat, lng]}
          zoom={15}
          scrollWheelZoom={false}
          dragging={false}
          doubleClickZoom={false}
          style={{ height: "100%", width: "100%" }}
          className="z-0"
        >
          {satellite ? (
            <TileLayer attribution="Esri, Maxar, Earthstar Geographics" url={ESRI_IMAGERY} maxZoom={19} />
          ) : (
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
          )}
          <CircleMarker
            center={[lat, lng]}
            radius={8}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: colour, fillOpacity: 0.95 }}
          />
        </MapContainer>
        <div className="absolute right-2 top-2 z-[400] flex overflow-hidden rounded-lg border border-line bg-white/95 text-[10px] font-bold shadow">
          <button
            onClick={() => setSatellite(false)}
            className={`px-2 py-1 ${!satellite ? "bg-navy text-white" : "text-navy"}`}
          >
            🗺️ Map
          </button>
          <button
            onClick={() => setSatellite(true)}
            className={`px-2 py-1 ${satellite ? "bg-navy text-white" : "text-navy"}`}
          >
            🛰️ Satellite
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink-soft">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </span>
        <button onClick={locate} className="text-xs font-bold text-kplc hover:underline">
          📍 Navigate to this transformer
        </button>
      </div>

      {navOpen && (
        <div className="mt-2 w-[300px] max-w-full rounded-lg border border-line bg-surface-2 p-3 text-xs">
          {(status === "locating" || status === "routing") && (
            <p className="text-ink-soft">
              {status === "locating" ? "Finding your location…" : "Calculating route…"}
            </p>
          )}
          {status === "ready" && route && (
            <>
              <p className={`font-extrabold ${roadRoute ? "text-navy" : "text-amber-800"}`}>
                🚗 {route.distanceKm.toFixed(1)} km · ⏱️ ~{Math.round(route.durationMin)} minutes
              </p>
              <p className="mt-1 text-[10px] leading-snug text-ink-soft">
                {roadRoute
                  ? "Real road-routed distance and time."
                  : `Straight-line estimate with a road-wander allowance — road routing unavailable${routeError ? ` (${routeError})` : ""}.`}
              </p>
              {!roadRoute && (
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="mt-1.5 rounded-lg bg-amber-600 px-2.5 py-1 text-[10px] font-bold text-white disabled:opacity-50"
                >
                  {retrying ? "Retrying…" : "Try again"}
                </button>
              )}
              <button
                onClick={() => { setOrigin(null); setRoute(null); setStatus("need-input"); }}
                className="mt-1.5 block text-[10px] font-bold text-ink-soft underline"
              >
                Use a different starting point
              </button>
            </>
          )}
          {status === "need-input" && (
            <form onSubmit={searchOrigin} className="flex gap-1.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter starting location…"
                className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-kplc"
              />
              <button type="submit" className="shrink-0 rounded-lg bg-navy px-2.5 py-1.5 text-xs font-bold text-white">
                Go
              </button>
            </form>
          )}
          {status === "searching" && <p className="text-ink-soft">Searching…</p>}
          {error && <p className="mt-1 font-semibold text-red-700">{error}</p>}
          <button onClick={() => setNavOpen(false)} className="mt-2 block text-[10px] font-bold text-ink-soft underline">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
