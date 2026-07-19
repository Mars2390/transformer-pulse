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

  // --- Position provenance -------------------------------------------------
  positionSource?: "SURVEYED" | "GEOCODED" | "UNAVAILABLE" | null;
  positionAccuracyM?: number | null;
  make?: string | null;
  substationName?: string | null;
  lastInspectionAt?: string | null;
};

/** Pin colours by status. These match the badges used everywhere else. */
const PIN_COLOUR: Record<TransformerStatus, string> = {
  IN_FIELD: "#0e8a4f",
  FAULTY: "#c02626",
  IN_TRANSIT: "#7c3aed",
  IN_STORE: "#1e40af",
  IN_REPAIR: "#d99e00",
  REPAIRED: "#0e8a4f",
  BEYOND_REPAIR: "#4b5563",
  AWAITING_REPLACEMENT: "#c02626",
  RETURNED: "#7b8383",
  SCRAPPED: "#7b8383",
};

export const KENYA_CENTER: [number, number] = [-1.2864, 36.8172];

/**
 * We use CircleMarker rather than Leaflet's default Marker on purpose.
 *
 * The default marker loads three PNGs by relative URL, which bundlers rewrite
 * and break — the classic "my map has no pins" bug. A CircleMarker is drawn by
 * Leaflet itself: no images, no broken paths, and we get to style it by both
 * status and position provenance for free.
 */
export default function TransformerMapInner({
  points,
  height = "100%",
  zoom = 11,
}: {
  points: MapPoint[];
  height?: string;
  zoom?: number;
}) {
  const center: [number, number] = points.length
    ? [
        points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        points.reduce((sum, p) => sum + p.lng, 0) / points.length,
      ]
    : KENYA_CENTER;

  const anyGeocoded = points.some((p) => p.positionSource === "GEOCODED");

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
        // A geocoded pin is drawn hollow with a dashed ring. It marks an area,
        // not an asset — a search engine matched a landmark, nobody stood
        // there. Drawing it the same as a surveyed pin would be lying by
        // omission, and someone would drive to it expecting a transformer.
        const estimated = point.positionSource === "GEOCODED";
        const colour = PIN_COLOUR[point.status];

        return (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={estimated ? 6 : 7}
            pathOptions={
              estimated
                ? { color: "#d99e00", weight: 2, dashArray: "3 3", fillColor: colour, fillOpacity: 0.3 }
                : { color: "#ffffff", weight: 2, fillColor: colour, fillOpacity: 0.95 }
            }
          >
            <Popup minWidth={230}>
              <PinPopup point={point} />
            </Popup>
          </CircleMarker>
        );
      })}

      <Legend showEstimated={anyGeocoded} points={points} />
    </MapContainer>
  );
}

/**
 * Everything a person needs before deciding to drive somewhere.
 *
 * The position badge is the load-bearing part: an amber "estimated" pin means
 * the crew should expect to look around when they arrive, and a green one means
 * the coordinates came off a GPS at the asset.
 */
function PinPopup({ point }: { point: MapPoint }) {
  const label = point.gNumber ? `G-${point.gNumber}` : point.serialNumber;
  const status = STATUS_META[point.status];

  const position =
    point.positionSource === "SURVEYED"
      ? { text: "Surveyed", detail: "GPS fix taken at the asset", bg: "#dcfce7", fg: "#166534" }
      : point.positionSource === "GEOCODED"
        ? {
            text: "Estimated from address",
            detail: `Matched from a written landmark — accurate to about ${point.positionAccuracyM ?? 150} m. Expect to look around on arrival.`,
            bg: "#fef3c7",
            fg: "#92400e",
          }
        : { text: "Position unconfirmed", detail: "No survey on record", bg: "#f1f5f9", fg: "#475569" };

  const site = [point.substationName, point.siteName].filter(Boolean).join(", ");

  return (
    <div className="p-2.5" style={{ minWidth: 210 }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-extrabold text-[#0a1a4f]">{label}</span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{
            backgroundColor: PIN_COLOUR[point.status] + "22",
            color: PIN_COLOUR[point.status],
          }}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-1 text-[11px] text-[#5b6480]">
        {[point.make, formatRating(point.ratingKva)].filter(Boolean).join(" · ")}
        {point.feeder ? ` · ${point.feeder}` : ""}
      </p>

      {site && (
        <p className="mt-1.5 text-[12px] font-semibold leading-snug text-[#1c1f1f]">{site}</p>
      )}

      <div
        className="mt-2 rounded px-2 py-1.5"
        style={{ backgroundColor: position.bg, color: position.fg }}
      >
        <p className="text-[11px] font-bold">📍 {position.text}</p>
        <p className="text-[10px] leading-snug opacity-90">{position.detail}</p>
      </div>

      <p className="mt-1.5 text-[10px] text-[#5b6480]">
        {point.lastInspectionAt
          ? `Last inspected ${point.lastInspectionAt}`
          : "No inspection on record"}
      </p>

      <div className="mt-2 grid gap-1">
        <Link
          href={`/transformers/${point.id}`}
          className="rounded bg-[#0e8a4f] px-2 py-1.5 text-center text-[11px] font-bold text-white no-underline"
        >
          View full story
        </Link>
        <div className="grid grid-cols-2 gap-1">
          <a
            href={`https://www.google.com/maps?q=${point.lat},${point.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-[#e3e6ec] px-2 py-1.5 text-center text-[11px] font-bold text-[#0a1a4f] no-underline"
          >
            🗺️ Maps
          </a>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-[#e3e6ec] px-2 py-1.5 text-center text-[11px] font-bold text-[#0a1a4f] no-underline"
          >
            📍 Navigate
          </a>
        </div>
      </div>

      <p className="mt-1.5 text-center font-mono text-[9px] text-[#9aa0ae]">
        {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
      </p>
    </div>
  );
}

/**
 * The legend only lists what is actually on the map.
 *
 * A legend entry for a category with nothing in it is noise, and worse, it
 * invites a question whose answer is "none of these".
 */
function Legend({ showEstimated, points }: { showEstimated: boolean; points: MapPoint[] }) {
  const has = (s: TransformerStatus) => points.some((p) => p.status === s);

  return (
    <div className="leaflet-bottom leaflet-left">
      <div className="leaflet-control m-3 rounded-lg border border-[#e3e6ec] bg-white/95 px-3 py-2 shadow-lg backdrop-blur">
        <p className="text-[10px] font-bold tracking-[0.08em] text-[#5b6480]">LEGEND</p>
        <ul className="mt-1.5 space-y-1">
          {has("IN_FIELD") && <Row colour="#0e8a4f" text="In field" />}
          {showEstimated && (
            <li className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full border-2 border-dashed"
                style={{ borderColor: "#d99e00", backgroundColor: "#0e8a4f33" }}
              />
              <span className="text-[11px] text-[#1c1f1f]">Estimated from address (~150 m)</span>
            </li>
          )}
          {has("FAULTY") && <Row colour="#c02626" text="Faulty" />}
          {has("AWAITING_REPLACEMENT") && <Row colour="#c02626" text="Awaiting replacement" />}
          {has("IN_REPAIR") && <Row colour="#d99e00" text="In repair" />}
          {has("IN_STORE") && <Row colour="#1e40af" text="In store" />}
          {has("IN_TRANSIT") && <Row colour="#7c3aed" text="In transit" />}
          {has("BEYOND_REPAIR") && <Row colour="#4b5563" text="Beyond repair" />}
        </ul>
        {showEstimated && (
          <p className="mt-1.5 max-w-[190px] text-[9px] leading-snug text-[#5b6480]">
            A dashed pin marks an area, not an asset. Nobody has surveyed it.
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ colour, text }: { colour: string; text: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="h-3 w-3 shrink-0 rounded-full border-2 border-white shadow-sm"
        style={{ backgroundColor: colour }}
      />
      <span className="text-[11px] text-[#1c1f1f]">{text}</span>
    </li>
  );
}
