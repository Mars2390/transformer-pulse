import type { MapPoint } from "@/components/map/TransformerMapInner";
import { ratedPhaseCurrent } from "@/lib/load-analysis";
import { deriveHealthStatus } from "@/lib/health-status";

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
  secondaryKv: true,
  status: true,
  currentLat: true,
  currentLng: true,
  currentSiteName: true,
  substationName: true,
  feeder: true,
  region: true,
  dataSource: true,
  verifiedAt: true,
  positionSource: true,
  positionAccuracyM: true,
  lastInspectionAt: true,
  physicalConditionScore: true,
  electricalStressScore: true,
  manufacturer: { select: { name: true } },
  // Latest hour of EMDis telemetry, for the popup's phase-loading summary.
  // Capped to one row so a popup never carries more than it needs.
  emdisHourly: {
    orderBy: { hourStart: "desc" as const },
    take: 1,
    select: { avgL1c: true, avgL2c: true, avgL3c: true, maxL1c: true, maxL2c: true, maxL3c: true },
  },
  // The most recent dataset, so the popup's "Load Analysis" button has
  // somewhere to go. No dataset means no button.
  emdisDatasets: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true },
  },
} as const;

type Row = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  secondaryKv?: number | null;
  status: string;
  currentLat: number | null;
  currentLng: number | null;
  currentSiteName: string | null;
  substationName?: string | null;
  feeder: string | null;
  region?: string | null;
  dataSource?: string | null;
  verifiedAt?: Date | null;
  positionSource?: string | null;
  positionAccuracyM?: number | null;
  lastInspectionAt?: Date | null;
  physicalConditionScore?: number | null;
  electricalStressScore?: number | null;
  manufacturer?: { name: string } | null;
  emdisHourly?: { avgL1c: number | null; avgL2c: number | null; avgL3c: number | null; maxL1c: number | null; maxL2c: number | null; maxL3c: number | null }[];
  emdisDatasets?: { id: string }[];
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
    .map((t) => {
      const hourly = t.emdisHourly?.[0];
      let phasePct: MapPoint["phasePct"] = null;
      if (hourly) {
        const voltLL = t.secondaryKv ? t.secondaryKv * 1000 : 415;
        const iRated = ratedPhaseCurrent(t.ratingKva, voltLL);
        const l1 = hourly.maxL1c ?? hourly.avgL1c;
        const l2 = hourly.maxL2c ?? hourly.avgL2c;
        const l3 = hourly.maxL3c ?? hourly.avgL3c;
        if (l1 != null && l2 != null && l3 != null && iRated > 0) {
          phasePct = {
            l1: (l1 / iRated) * 100,
            l2: (l2 / iRated) * 100,
            l3: (l3 / iRated) * 100,
          };
        }
      }

      // A simple 0-100 "health" band for the map's health filter — the average
      // of the two cached condition scores when both are known. Neither score
      // being measured yet is common for a freshly onboarded unit, and that is
      // "unknown", never a fabricated 100.
      const scores = [t.physicalConditionScore, t.electricalStressScore].filter(
        (s): s is number => s != null,
      );
      const healthScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

      // The 5-level status (Healthy/Breathing/Surviving/Critical/Deceased) shown
      // on the pin popup — the same worst-axis-dominates logic as the story
      // page, just without the detailed reasons list a full priority-list scan
      // would need for every pin on the map.
      const healthStatus = deriveHealthStatus({
        electrical: t.electricalStressScore ?? null,
        physical: t.physicalConditionScore ?? null,
        status: t.status as MapPoint["status"],
      });

      return {
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
        region: t.region ?? null,
        dataSource: t.dataSource ?? null,
        verified: t.verifiedAt != null,
        positionSource: (t.positionSource as MapPoint["positionSource"]) ?? null,
        positionAccuracyM: t.positionAccuracyM ?? null,
        make: t.manufacturer?.name ?? null,
        lastInspectionAt: t.lastInspectionAt ? t.lastInspectionAt.toISOString().slice(0, 10) : null,
        phasePct,
        healthScore,
        healthStatus,
        latestDatasetId: t.emdisDatasets?.[0]?.id ?? null,
      };
    });
}

/** How many of a set can actually be drawn, for the honest caption. */
export function mapCoverage(rows: { currentLat: number | null }[]) {
  const placed = rows.filter((r) => r.currentLat != null).length;
  return { placed, missing: rows.length - placed, total: rows.length };
}
