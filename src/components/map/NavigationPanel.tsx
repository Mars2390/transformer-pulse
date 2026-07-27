"use client";

import { useEffect, useState } from "react";
import { CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";

export type NavTarget = { lat: number; lng: number; label: string };

/** A conservative mixed urban/rural driving average for Kenyan roads. */
const AVG_SPEED_KMH = 28;

/** Great-circle distance between two points, in kilometres. No API, no key. */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/**
 * In-map navigation — the Bolt/Uber-style "where am I, where is it, how far"
 * view, built entirely on the free stack: the browser's own GPS, Nominatim for
 * a typed starting point, and a straight-line Haversine distance drawn as a
 * polyline. Nothing here calls out to Google Maps; the whole thing lives on
 * this Leaflet instance.
 *
 * Straight-line distance rather than a routed distance is an honest
 * simplification: with no turn-by-turn OSRM server to call, quoting a road
 * distance we did not actually compute would be a fabricated figure with a
 * confident decimal point. The travel-time estimate is scaled up from the
 * straight-line figure precisely because real roads are never straight.
 */
export function NavigationPanel({ target, onClose }: { target: NavTarget; onClose: () => void }) {
  const map = useMap();
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<"locating" | "need-input" | "searching" | "ready">("locating");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setStatus("need-input");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setOrigin(o);
        setStatus("ready");
        map.flyToBounds(L.latLngBounds([[o.lat, o.lng], [target.lat, target.lng]]), { padding: [48, 48] });
      },
      () => setStatus("need-input"),
      { enableHighAccuracy: true, timeout: 8000 },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    );
  }, [map, target.lat, target.lng]);

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
      setStatus("ready");
      map.flyToBounds(L.latLngBounds([[o.lat, o.lng], [target.lat, target.lng]]), { padding: [48, 48] });
    } catch {
      setError("Search is unavailable right now — try again.");
      setStatus("need-input");
    }
  }

  const distanceKm = origin ? haversineKm(origin, target) : null;
  // +35% over the straight line for real road wander, then at the average
  // speed above — a rough but honest planning figure, not a routed ETA.
  const minutes = distanceKm != null ? Math.round(((distanceKm * 1.35) / AVG_SPEED_KMH) * 60) : null;

  return (
    <>
      {origin && (
        <>
          <CircleMarker
            center={[origin.lat, origin.lng]}
            radius={9}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#2563eb", fillOpacity: 0.95 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              You are here
            </Tooltip>
          </CircleMarker>
          <Polyline
            positions={[[origin.lat, origin.lng], [target.lat, target.lng]]}
            pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.85 }}
          />
          <CircleMarker
            center={[target.lat, target.lng]}
            radius={9}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#c02626", fillOpacity: 0.95 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              {target.label}
            </Tooltip>
          </CircleMarker>
        </>
      )}

      <div className="leaflet-top leaflet-left" style={{ marginTop: 70 }}>
        <div className="leaflet-control m-3 w-72 rounded-xl border border-line bg-white/97 p-3.5 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-extrabold tracking-[0.08em] text-[#0a1a4f]">
              📍 NAVIGATE TO {target.label}
            </p>
            <button
              onClick={onClose}
              className="rounded px-1.5 py-0.5 text-xs font-bold text-[#5b6480] hover:bg-black/5"
              aria-label="Close navigation"
            >
              ✕
            </button>
          </div>

          {status === "locating" && (
            <p className="mt-2 text-xs text-[#5b6480]">Finding your location…</p>
          )}

          {status === "ready" && distanceKm != null && (
            <div className="mt-2 rounded-lg bg-[#eff6ff] px-3 py-2.5">
              <p className="text-sm font-extrabold text-[#1d4ed8]">
                Distance: {distanceKm.toFixed(1)} km
              </p>
              <p className="text-xs font-semibold text-[#1d4ed8]">
                Estimated travel: ~{minutes} minutes
              </p>
              <p className="mt-1 text-[10px] text-[#5b6480]">
                Straight-line distance with a road-wander allowance — no live routing service is
                connected, so treat this as a planning figure, not turn-by-turn directions.
              </p>
            </div>
          )}

          {status === "need-input" && (
            <div className="mt-2">
              <p className="text-xs text-[#5b6480]">
                {error ?? "Location wasn't shared. Enter a starting point instead."}
              </p>
              <form onSubmit={searchOrigin} className="mt-2 flex gap-1.5">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Enter starting location…"
                  className="min-w-0 flex-1 rounded-lg border border-[#e3e6ec] px-2 py-1.5 text-xs outline-none focus:border-[#0e8a4f]"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-lg bg-[#0a1a4f] px-2.5 py-1.5 text-xs font-bold text-white"
                >
                  Go
                </button>
              </form>
            </div>
          )}

          {status === "searching" && <p className="mt-2 text-xs text-[#5b6480]">Searching…</p>}

          {origin && status === "ready" && (
            <button
              onClick={() => {
                setOrigin(null);
                setStatus("need-input");
              }}
              className="mt-2 text-[10px] font-bold text-[#5b6480] underline"
            >
              Use a different starting point
            </button>
          )}
        </div>
      </div>
    </>
  );
}
