"use client";

import { MapContainer, TileLayer, CircleMarker } from "react-leaflet";
import "leaflet/dist/leaflet.css";

/**
 * A small, static map showing one point. Used on each timeline event that
 * carries GPS. CircleMarker, not the default marker, so there are no image
 * assets to break — see TransformerMapInner for the full reasoning.
 */
export default function MiniMapInner({
  lat,
  lng,
  colour = "#1e40af",
}: {
  lat: number;
  lng: number;
  colour?: string;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={14}
      scrollWheelZoom={false}
      dragging={false}
      doubleClickZoom={false}
      zoomControl={false}
      attributionControl={false}
      style={{ height: "100%", width: "100%" }}
      className="z-0"
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
      <CircleMarker
        center={[lat, lng]}
        radius={8}
        pathOptions={{ color: "#ffffff", weight: 2, fillColor: colour, fillOpacity: 0.95 }}
      />
    </MapContainer>
  );
}
