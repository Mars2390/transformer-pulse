import type { MapPoint } from "@/components/map/TransformerMapInner";

/**
 * One shape for every map in the system.
 *
 * There are five map views — manager dashboard, manager full map, field
 * dashboard, field map, and the mini map on a transformer's story. Before this
 * they each built their own point objects, which meant a field added to the
 * popup appeared on some maps and not others, and nobody could say which.
 *
 * The select and the mapper live together here so that cannot happen: add a
 * field to the popup, add it in one place, and every map has it.
 */

export const MAP_POINT_SELECT = {
  id: true,
  gNumber: true,
  serialNumber: true,
  ratingKva: true,
  status: true,
  currentLat: true,
  currentLng: true,
  currentSiteName: true,
  substationName: true,
  feeder: true,
  dataSource: true,
  verifiedAt: true,
  positionSource: true,
  positionAccuracyM: true,
  lastInspectionAt: true,
  manufacturer: { select: { name: true } },
} as const;

type Row = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  currentSiteName: string | null;
  substationName?: string | null;
  feeder: string | null;
  dataSource?: string | null;
  verifiedAt?: Date | null;
  positionSource?: string | null;
  positionAccuracyM?: number | null;
  lastInspectionAt?: Date | null;
  manufacturer?: { name: string } | null;
};

/**
 * Rows to points, dropping anything that cannot be drawn.
 *
 * A transformer with no coordinates is not a bug and not an error — the
 * inspection register holds a written landmark and no GPS for most of the
 * fleet. It simply cannot be placed, and the counts alongside the map say how
 * many are missing rather than quietly implying the map is complete.
 */
export function toMapPoints(rows: Row[]): MapPoint[] {
  return rows
    .filter((t) => t.currentLat != null && t.currentLng != null)
    .map((t) => ({
      id: t.id,
      gNumber: t.gNumber,
      serialNumber: t.serialNumber,
      ratingKva: t.ratingKva,
      status: t.status as MapPoint["status"],
      lat: t.currentLat!,
      lng: t.currentLng!,
      siteName: t.currentSiteName,
      substationName: t.substationName ?? null,
      feeder: t.feeder,
      dataSource: t.dataSource ?? null,
      verified: t.verifiedAt != null,
      positionSource: (t.positionSource as MapPoint["positionSource"]) ?? null,
      positionAccuracyM: t.positionAccuracyM ?? null,
      make: t.manufacturer?.name ?? null,
      lastInspectionAt: t.lastInspectionAt
        ? t.lastInspectionAt.toISOString().slice(0, 10)
        : null,
    }));
}

/** How many of a set can actually be drawn, for the honest caption. */
export function mapCoverage(rows: { currentLat: number | null }[]) {
  const placed = rows.filter((r) => r.currentLat != null).length;
  return { placed, missing: rows.length - placed, total: rows.length };
}
