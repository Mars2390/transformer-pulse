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

      {points.map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.lat, point.lng]}
          radius={7}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: PIN_COLOUR[point.status],
            fillOpacity: 0.95,
          }}
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
              <Link
                href={`/transformers/${point.id}`}
                className="mt-2 inline-block text-xs font-bold text-[#1e40af] underline"
              >
                Open full record →
              </Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
