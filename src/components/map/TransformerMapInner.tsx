"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import type { TransformerStatus } from "@/generated/prisma/enums";
import { formatRating, STATUS_META } from "@/lib/format";

export type MapPoint = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  status: TransformerStatus;
  lat: number;
  lng: number;
  siteName: string | null;
  feeder: string | null;
  /** Set when the unit was onboarded rather than installed through a store. */
  dataSource?: string | null;
  /** Set once a field engineer has physically stood at the asset. */
  verified?: boolean;
};

/** Pin colours. These match the status badges elsewhere in the app. */
const PIN_COLOUR: Record<TransformerStatus, string> = {
  IN_FIELD: "#0e8a4f",
  FAULTY: "#c02626",
  IN_TRANSIT: "#d99e00",
  IN_STORE: "#1e40af",
  RETURNED: "#7b8383",
  SCRAPPED: "#7b8383",
};

export const KENYA_CENTER: [number, number] = [-1.2, 36.9];

/**
 * We use CircleMarker rather than Leaflet's default Marker on purpose.
 *
 * The default marker loads three PNGs by relative URL, which bundlers rewrite
 * and break — the classic "my map has no pins" bug. A CircleMarker is drawn by
 * Leaflet itself: no images, no broken paths, and we get to colour it by status
 * for free.
 */
export default function TransformerMapInner({
  points,
  height = "100%",
  zoom = 10,
}: {
  points: MapPoint[];
  height?: string;
  zoom?: number;
}) {
  // Centre on the data we actually have, not on a hard-coded guess.
  const center: [number, number] = points.length
    ? [
        points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        points.reduce((sum, p) => sum + p.lng, 0) / points.length,
      ]
    : KENYA_CENTER;

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={false}
      style={{ height, width: "100%" }}
      className="z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {points.map((point) => {
        // An unverified onboarded unit is drawn hollow with a dashed amber ring.
        // It is a claim about where a transformer is, not a confirmation — and
        // the map should not let those two look identical.
        const unverified = Boolean(point.dataSource) && !point.verified;
        return (
        <CircleMarker
          key={point.id}
          center={[point.lat, point.lng]}
          radius={7}
          pathOptions={
            unverified
              ? { color: "#d99e00", weight: 2, dashArray: "3 3", fillColor: "#fbbf24", fillOpacity: 0.35 }
              : { color: "#ffffff", weight: 2, fillColor: PIN_COLOUR[point.status], fillOpacity: 0.95 }
          }
        >
          <Popup>
            <div className="p-3">
              <p className="text-[11px] font-bold tracking-wide text-[#5b6480]">
                {point.gNumber ?? point.serialNumber}
              </p>
              <p className="mt-0.5 text-sm font-bold text-[#0a1a4f]">
                {point.siteName ?? "Unknown site"}
              </p>
              <p className="mt-1 text-xs text-[#5b6480]">
                {formatRating(point.ratingKva)}
                {point.feeder ? ` · ${point.feeder}` : ""}
              </p>
              <p className="mt-2 text-xs font-semibold text-[#0a1a4f]">
                {STATUS_META[point.status].label}
              </p>
              {unverified && (
                <p className="mt-1.5 rounded bg-[#fef3c7] px-2 py-1 text-[11px] font-semibold text-[#92400e]">
                  Demonstration data — not yet physically inspected
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Link
                  href={`/transformers/${point.id}`}
                  className="text-xs font-bold text-[#1e40af] underline"
                >
                  Open full record →
                </Link>
                <a
                  href={`https://www.google.com/maps?q=${point.lat},${point.lng}&layer=c`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-[#1e40af] underline"
                >
                  Street View
                </a>
              </div>
            </div>
          </Popup>
        </CircleMarker>
        );
      })}

      <Legend showDemo={points.some((p) => p.dataSource && !p.verified)} />
    </MapContainer>
  );
}

/**
 * Sits over the map, bottom-left. Only mentions demonstration data when some is
 * actually on screen — a legend entry for a category with nothing in it is
 * noise, and worse, it invites the question on a map where the answer is "none
 * of these".
 */
function Legend({ showDemo }: { showDemo: boolean }) {
  return (
    <div className="leaflet-bottom leaflet-left">
      <div className="leaflet-control m-3 rounded-lg border border-[#e3e6ec] bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <p className="text-[10px] font-bold tracking-[0.08em] text-[#5b6480]">LEGEND</p>
        <ul className="mt-1.5 space-y-1">
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-white bg-[#0e8a4f] shadow-sm" />
            <span className="text-[11px] text-[#1c1f1f]">Verified — physical inspection</span>
          </li>
          {showDemo && (
            <li className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-dashed border-[#d99e00] bg-[#fbbf24]/40" />
              <span className="text-[11px] text-[#1c1f1f]">Demonstration data — OpenStreetMap</span>
            </li>
          )}
          <li className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-white bg-[#c02626] shadow-sm" />
            <span className="text-[11px] text-[#1c1f1f]">Faulty</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
