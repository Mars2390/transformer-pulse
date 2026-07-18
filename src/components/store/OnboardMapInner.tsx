"use client";

import { useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export type ExistingPin = { id: string; gNumber: string | null; lat: number; lng: number };

const NAIROBI: [number, number] = [-1.2864, 36.8172];

/** Click anywhere to move the pin. */
function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Lets the search box fly the map without re-mounting it. */
function MapHandle({ onReady }: { onReady: (m: LeafletMap) => void }) {
  const map = useMap();
  onReady(map);
  return null;
}

export default function OnboardMapInner({
  pin,
  onPick,
  existing,
}: {
  pin: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  existing: ExistingPin[];
}) {
  const mapRef = useRef<LeafletMap | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const center = useMemo<[number, number]>(
    () => (pin ? [pin.lat, pin.lng] : NAIROBI),
    // Only the FIRST pin position seeds the centre. Recentring on every drag
    // would fight the operator for control of the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Geocoding via Nominatim — the same OpenStreetMap project as the tiles.
   * It asks for a real search term rather than firing on every keystroke:
   * Nominatim's usage policy is one request per second, and a per-keystroke
   * lookup would get the demo rate-limited at the worst possible moment.
   */
  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", `${q}, Nairobi, Kenya`);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const hits = (await res.json()) as { lat: string; lon: string }[];
      if (!hits.length) {
        setSearchError(`Nothing found for "${q}".`);
        return;
      }
      const lat = Number(hits[0].lat), lng = Number(hits[0].lon);
      mapRef.current?.flyTo([lat, lng], 18, { duration: 0.8 });
      onPick(lat, lng);
    } catch {
      setSearchError("Search is unavailable. Drop the pin by hand instead.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* --- Search ---------------------------------------------------------- */}
      <form onSubmit={search} className="flex gap-2 border-b border-line bg-white p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a place — Sarit Centre, Ngong Road…"
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-kplc"
        />
        <button
          type="submit"
          disabled={searching}
          className="shrink-0 rounded-lg bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {searchError && (
        <p className="border-b border-line bg-amber-50 px-3 py-2 text-xs text-amber-900">{searchError}</p>
      )}

      {/* --- Map ------------------------------------------------------------- */}
      <div className="relative flex-1">
        <MapContainer center={center} zoom={pin ? 18 : 12} scrollWheelZoom style={{ height: "100%", width: "100%" }} className="z-0">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <MapHandle onReady={(m) => { mapRef.current = m; }} />
          <ClickCatcher onPick={onPick} />

          {/* Already on the register — grey, so the keeper does not add a duplicate. */}
          {existing.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lng]}
              radius={6}
              pathOptions={{ color: "#7b8383", fillColor: "#9aa0ae", fillOpacity: 0.75, weight: 1.5 }}
            >
              <Popup>
                <span className="text-xs font-semibold">{p.gNumber ?? "Unnumbered"}</span>
                <br />
                <span className="text-xs">Already onboarded</span>
              </Popup>
            </CircleMarker>
          ))}

          {/* The new one — green, larger, unmistakably the active pin. */}
          {pin && (
            <CircleMarker
              center={[pin.lat, pin.lng]}
              radius={11}
              pathOptions={{ color: "#0b6b3a", fillColor: "#0e8a4f", fillOpacity: 0.9, weight: 3 }}
              // Dragging a CircleMarker is not built in, so the map handles it:
              // click to place, click again to move. Simpler, and it works the
              // same on a phone as on a desktop.
            />
          )}
        </MapContainer>

        {!pin && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[400] flex justify-center">
            <p className="rounded-full bg-navy/90 px-4 py-1.5 text-xs font-bold text-white">
              Click the map to place the transformer
            </p>
          </div>
        )}
      </div>

      {/* --- Live coordinates ------------------------------------------------ */}
      <div className="border-t border-line bg-white px-4 py-3">
        {pin ? (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="font-mono text-sm">
              <div>
                <span className="text-ink-soft">Latitude:</span>{" "}
                <span className="font-bold text-navy">{pin.lat.toFixed(6)}</span>
              </div>
              <div>
                <span className="text-ink-soft">Longitude:</span>{" "}
                <span className="font-bold text-navy">{pin.lng.toFixed(6)}</span>
              </div>
              <p className="mt-1 font-sans text-[11px] text-ink-soft">
                Manual pin — around 5 m if you can see the unit
              </p>
            </div>
            <a
              href={`https://www.google.com/maps?q=${pin.lat},${pin.lng}&layer=c`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-bold text-navy hover:border-kplc hover:text-kplc"
            >
              🗺️ View on Street View
            </a>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">No pin placed yet.</p>
        )}
      </div>
    </div>
  );
}
