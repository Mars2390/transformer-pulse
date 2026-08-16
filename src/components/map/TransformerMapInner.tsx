"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, LayerGroup, CircleMarker, Popup, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import type { TransformerStatus } from "@/generated/prisma/enums";
import { formatRating, STATUS_META } from "@/lib/format";
import type { PhaseKey } from "@/lib/phase-colors";
import { NavigationPanel, type NavTarget } from "@/components/map/NavigationPanel";
import { HEALTH_STATUS_META, type HealthStatusLevel } from "@/lib/health-status";

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
  region?: string | null;
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

  /** Latest hour of EMDis telemetry, as % of rated phase current. */
  phasePct?: { l1: number; l2: number; l3: number } | null;
  /** 0-100 cached condition band, or null when not yet measured. */
  healthScore?: number | null;
  /** The 5-level status shown on the badge — Healthy/Breathing/Surviving/Critical/Deceased. */
  healthStatus?: { level: HealthStatusLevel; explanation: string } | null;
  /** Most recent EMDis dataset for this unit, so the popup can link to it. */
  latestDatasetId?: string | null;
};

/** Pin colours by status. These match the badges used everywhere else. */
const PIN_COLOUR: Record<TransformerStatus, string> = {
  PENDING_APPROVAL: "#d99e00",
  REJECTED: "#7b8383",
  IN_FIELD: "#0e8a4f",
  FAULTY: "#c02626",
  IN_TRANSIT: "#7c3aed",
  IN_STORE: "#1e40af",
  AT_WORKSHOP: "#d99e00",
  IN_REPAIR: "#d99e00", // deprecated, see schema
  REPAIRED: "#0e8a4f",
  BEYOND_REPAIR: "#4b5563",
  AWAITING_REPLACEMENT: "#c02626",
  RETURNED: "#7b8383",
  SCRAPPED: "#7b8383",
};

export const KENYA_CENTER: [number, number] = [-1.2864, 36.8172];

type BaseLayer = "street" | "satellite" | "hybrid";

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_REFERENCE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/** The basemap tiles, swapped by our own toggle rather than Leaflet's LayersControl — this is what lets a popup's "Satellite View" button switch the layer programmatically. */
function Basemap({ layer }: { layer: BaseLayer }) {
  if (layer === "street") {
    return (
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
    );
  }
  return (
    <LayerGroup>
      <TileLayer attribution="Esri, Maxar, Earthstar Geographics" url={ESRI_IMAGERY} maxZoom={19} />
      {layer === "hybrid" && <TileLayer url={ESRI_REFERENCE} maxZoom={19} />}
    </LayerGroup>
  );
}

function LayerToggle({ layer, setLayer }: { layer: BaseLayer; setLayer: (l: BaseLayer) => void }) {
  const opt: { key: BaseLayer; label: string }[] = [
    { key: "street", label: "🗺️ Street Map" },
    { key: "satellite", label: "🛰️ Satellite" },
    { key: "hybrid", label: "Hybrid" },
  ];
  return (
    <div className="leaflet-top leaflet-right">
      <div className="leaflet-control m-3 flex overflow-hidden rounded-lg border border-[#e3e6ec] bg-white/95 text-[11px] font-bold shadow-lg backdrop-blur">
        {opt.map((o) => (
          <button
            key={o.key}
            onClick={() => setLayer(o.key)}
            className={`px-2.5 py-1.5 transition-colors ${
              layer === o.key ? "bg-[#0a1a4f] text-white" : "text-[#0a1a4f] hover:bg-black/5"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MapReady({ onReady }: { onReady: (m: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => onReady(map), [map, onReady]);
  return null;
}

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
  const [layer, setLayer] = useState<BaseLayer>("street");
  const [navTarget, setNavTarget] = useState<NavTarget | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  const center: [number, number] = points.length
    ? [
        points.reduce((sum, p) => sum + p.lat, 0) / points.length,
        points.reduce((sum, p) => sum + p.lng, 0) / points.length,
      ]
    : KENYA_CENTER;

  const anyGeocoded = points.some((p) => p.positionSource === "GEOCODED");

  function viewSatellite(point: MapPoint) {
    setLayer("satellite");
    mapRef.current?.flyTo([point.lat, point.lng], 19, { duration: 0.8 });
  }

  function startNavigate(point: MapPoint) {
    setNavTarget({
      lat: point.lat,
      lng: point.lng,
      label: point.gNumber ? `G-${point.gNumber}` : point.serialNumber,
      subtitle: [point.substationName, point.siteName].filter(Boolean).join(", ") || null,
    });
  }

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={false}
      style={{ height, width: "100%" }}
      className="z-0"
    >
      <MapReady onReady={(m) => { mapRef.current = m; }} />
      <Basemap layer={layer} />
      <LayerToggle layer={layer} setLayer={setLayer} />

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
            <Popup minWidth={240}>
              <PinPopup point={point} onSatellite={() => viewSatellite(point)} onNavigate={() => startNavigate(point)} />
            </Popup>
          </CircleMarker>
        );
      })}

      {navTarget && (
        <NavigationPanel
          target={navTarget}
          onClose={() => setNavTarget(null)}
          onSatellite={() => {
            setLayer("satellite");
            mapRef.current?.flyTo([navTarget.lat, navTarget.lng], 19, { duration: 0.8 });
          }}
        />
      )}

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
function PinPopup({
  point,
  onSatellite,
  onNavigate,
}: {
  point: MapPoint;
  onSatellite: () => void;
  onNavigate: () => void;
}) {
  const label = point.gNumber ? `G-${point.gNumber}` : point.serialNumber;
  const status = STATUS_META[point.status];

  const position =
    point.positionSource === "SURVEYED"
      ? { text: "📍 Surveyed", detail: "GPS fix taken at the asset", bg: "#dcfce7", fg: "#166534" }
      : point.positionSource === "GEOCODED"
        ? {
            text: "📍 Geocoded — estimated",
            detail: `Matched from a written landmark — accurate to about ${point.positionAccuracyM ?? 150} m. Expect to look around on arrival.`,
            bg: "#fef3c7",
            fg: "#92400e",
          }
        : { text: "📍 Unavailable", detail: "No survey on record", bg: "#f1f5f9", fg: "#475569" };

  const site = [point.substationName, point.siteName].filter(Boolean).join(", ");

  const days = point.lastInspectionAt
    ? Math.floor((Date.now() - new Date(point.lastInspectionAt).getTime()) / 86_400_000)
    : null;
  const overdue = days != null && days > 180;

  return (
    <div className="p-2.5" style={{ minWidth: 220 }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-extrabold text-[#0a1a4f]">{label}</span>
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

      {point.healthStatus && (
        <p
          className="mt-1 text-[10px] font-bold"
          style={{ color: HEALTH_STATUS_META[point.healthStatus.level].colour }}
          title={point.healthStatus.explanation}
        >
          {HEALTH_STATUS_META[point.healthStatus.level].emoji} {HEALTH_STATUS_META[point.healthStatus.level].label.toUpperCase()}
          <span className="ml-1 font-semibold text-[#5b6480]">— {point.healthStatus.explanation}</span>
        </p>
      )}

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
        <p className="text-[11px] font-bold">{position.text}</p>
        <p className="text-[10px] leading-snug opacity-90">{position.detail}</p>
      </div>

      <p className={`mt-1.5 text-[10px] ${overdue ? "font-bold text-[#c02626]" : "text-[#5b6480]"}`}>
        {point.lastInspectionAt
          ? `Last inspected ${point.lastInspectionAt}${days != null ? ` — ${days} days ago${overdue ? " — OVERDUE" : ""}` : ""}`
          : "No inspection on record"}
      </p>

      {point.phasePct && (
        <p className="mt-1.5 rounded bg-[#f1f5f9] px-2 py-1 text-[10px] font-semibold text-[#1c1f1f]">
          {(["l1", "l2", "l3"] as const)
            .map((k) => {
              const key = k.toUpperCase() as PhaseKey;
              const pct = point.phasePct![k];
              const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "⚠️" : "✅";
              return `${key}: ${pct.toFixed(0)}% ${emoji}`;
            })
            .join(" | ")}
        </p>
      )}

      <div className="mt-2 grid gap-1">
        <Link
          href={`/transformers/${point.id}`}
          className="rounded bg-[#0e8a4f] px-2 py-1.5 text-center text-[11px] font-bold text-white no-underline"
        >
          View full story
        </Link>
        <div className="grid grid-cols-2 gap-1">
          <button
            onClick={onSatellite}
            className="rounded border border-[#e3e6ec] px-2 py-1.5 text-center text-[11px] font-bold text-[#0a1a4f]"
          >
            🛰️ Satellite View
          </button>
          <button
            onClick={onNavigate}
            className="rounded border border-[#e3e6ec] px-2 py-1.5 text-center text-[11px] font-bold text-[#0a1a4f]"
          >
            📍 Navigate
          </button>
        </div>
        {point.latestDatasetId && (
          <Link
            href={`/manager/load-analysis/${point.latestDatasetId}`}
            className="rounded border border-[#e3e6ec] px-2 py-1.5 text-center text-[11px] font-bold text-[#0a1a4f] no-underline"
          >
            ⚡ Load Analysis
          </Link>
        )}
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
          {has("AT_WORKSHOP") && <Row colour="#d99e00" text="At workshop" />}
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
