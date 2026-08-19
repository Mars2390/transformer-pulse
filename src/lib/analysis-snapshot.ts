/**
 * The single source of truth for every derived load figure.
 *
 * There used to be three unbalance numbers in circulation for one transformer:
 * 42.72% from the reading API, 63.0% from the manager screen (a window median)
 * and 136% from the priority list (a window maximum). All three were arithmetic
 * on the same file. None of them agreed, so none of them could be trusted, and
 * an engineer asked to sign off a load transfer had no defensible figure.
 *
 * The cause was not the formulas. It was that four different call sites each
 * aggregated the readings their own way. This module removes the choice: one
 * reading is designated the SNAPSHOT, every derived quantity is computed from
 * it once, the result is STORED, and every consumer — API response, alert
 * generator, priority score, PDF, MCP tool — reads the stored value.
 *
 * Nothing downstream is allowed to aggregate. If a screen wants the spread
 * across the window it asks for unbalanceWindow and labels it as such.
 */

import {
  analyseReading,
  nemaUnbalancePct,
  ratedPhaseCurrent,
  unbalanceLossFactorOf,
  LIMITS,
  type Severity,
} from "./load-analysis";
import { computeThermal, type ThermalBand } from "./transformer-thermal";
import {
  resolveThermalConstants,
  type ThermalConstants,
  type ThermalConstantsRecord,
} from "./thermal-constants";

/** The columns this needs off an EmdisReading row. Structural on purpose. */
export type SnapshotSourceRow = {
  recordedAt: Date;
  l1c: number | null;
  l2c: number | null;
  l3c: number | null;
  neutralC: number | null;
  l1nV?: number | null;
  l2nV?: number | null;
  l3nV?: number | null;
  kva: number | null;
  kw?: number | null;
  pf: number | null;
  thdPct?: number | null;
  /** Stored derived values, written at ingest by analyseReading. */
  loadingPct?: number | null;
  phaseUnbalancePct?: number | null;
  maxPhaseC?: number | null;
  maxPhasePctRated?: number | null;
  neutralPctRated?: number | null;
};

export type DerivedSnapshot = {
  recordedAt: Date;
  /** Index into the time-sorted rows the snapshot was picked from, if known. */
  index: number | null;
  selectedBecause: string;

  ratingKva: number;
  voltLL: number;
  ratedPhaseA: number;

  l1c: number;
  l2c: number;
  l3c: number;
  neutralC: number | null;
  kva: number | null;
  kw: number | null;
  pf: number | null;
  thdPct: number | null;
  avgVoltage: number | null;

  meanPhaseA: number;
  maxPhaseA: number;
  worstDeviationA: number;
  hottestPhase: "L1" | "L2" | "L3" | null;

  /** kVA / rating x 100, from this reading. */
  loadingPct: number;
  /** NEMA MG-1 current unbalance, from THIS reading. THE unbalance figure. */
  unbalancePct: number;
  maxPhasePctRated: number;
  neutralPctRated: number | null;
  zeroSequenceA: number | null;
  unbalanceLossFactor: number;

  ambientC: number;
  constants: ThermalConstants;
  constantsProvenance: string;
  lossRatioSource: string;

  topOilRiseK: number;
  topOilC: number;
  hotSpotRiseK: number;
  hotSpotC: number;
  ageingRate: number;
  thermalBand: ThermalBand;
  /** Hot-spot on the worst-winding basis, for the gap the kVA figure hides. */
  hotSpotByPhaseC: number;

  severity: Severity;
};

const num = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? 0 : x);

/**
 * Pick the snapshot row: peak loading, falling back to peak phase current when
 * the export carries no kVA channel. Ties go to the later reading.
 *
 * Rows do NOT have to be pre-sorted, but the returned index refers to the
 * time-sorted order so it lines up with analyseDataset.
 */
export function pickSnapshotRow<T extends SnapshotSourceRow>(
  rows: T[],
): { row: T; index: number; reason: string } | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const loadingOf = (r: T) =>
    r.loadingPct != null && Number.isFinite(r.loadingPct) ? r.loadingPct : r.kva != null ? r.kva : 0;
  const phaseOf = (r: T) =>
    r.maxPhaseC != null ? num(r.maxPhaseC) : Math.max(num(r.l1c), num(r.l2c), num(r.l3c));

  const anyLoading = sorted.some((r) => loadingOf(r) > 0);
  let best = 0;
  for (let i = 1; i < sorted.length; i++) {
    const key = anyLoading ? loadingOf(sorted[i]) : phaseOf(sorted[i]);
    const bestKey = anyLoading ? loadingOf(sorted[best]) : phaseOf(sorted[best]);
    if (key >= bestKey) best = i;
  }

  return {
    row: sorted[best],
    index: best,
    reason: anyLoading
      ? "peak measured loading in this window"
      : "peak phase current in this window (no kVA channel in the export)",
  };
}

export type DeriveInput = {
  row: SnapshotSourceRow;
  index?: number | null;
  selectedBecause?: string;
  ratingKva: number;
  voltLL: number;
  ambientC: number;
  /** The transformer record, for the five thermal constants. Null is fine. */
  transformer?: ThermalConstantsRecord | null;
  /** Fallback power factor for the efficiency figure. */
  fallbackPf?: number;
};

/**
 * Derive every headline figure from ONE reading.
 *
 * This is the only function in the codebase allowed to produce a loadingPct and
 * an unbalancePct that will be shown to a human, and it produces them from the
 * same row in the same call. They cannot drift apart.
 */
export function deriveSnapshot(input: DeriveInput): DerivedSnapshot {
  const { row, ratingKva, voltLL, ambientC } = input;
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);

  const l1 = num(row.l1c);
  const l2 = num(row.l2c);
  const l3 = num(row.l3c);

  const a = analyseReading(
    {
      l1c: l1, l2c: l2, l3c: l3,
      neutralC: row.neutralC ?? null,
      l1nV: row.l1nV ?? null, l2nV: row.l2nV ?? null, l3nV: row.l3nV ?? null,
      kva: row.kva ?? null, kw: row.kw ?? null, pf: row.pf ?? null,
      thdPct: row.thdPct ?? null,
    },
    ratingKva,
    voltLL,
  );

  const resolved = resolveThermalConstants(input.transformer);
  const pf = row.pf != null && row.pf > 0.1 ? row.pf : (input.fallbackPf ?? 0.95);

  // The thermal run that the report quotes, on the same basis as loadingPct.
  const t = computeThermal({
    loadKva: (a.loadingPct / 100) * ratingKva,
    ratingKva,
    ambientC,
    transformer: input.transformer ?? null,
    powerFactor: pf,
  });

  // The worst-winding view, kept because an unbalanced unit is hotter than its
  // kVA figure admits. Shown next to the headline, never instead of it.
  const tPhase = computeThermal({
    loadKva: (a.maxPhasePctRated / 100) * ratingKva,
    ratingKva,
    ambientC,
    transformer: input.transformer ?? null,
    powerFactor: pf,
  });

  const mean = a.meanPhaseC;
  const worstDeviationA = mean <= 1
    ? 0
    : Math.max(Math.abs(l1 - mean), Math.abs(l2 - mean), Math.abs(l3 - mean));

  return {
    recordedAt: row.recordedAt,
    index: input.index ?? null,
    selectedBecause: input.selectedBecause ?? "peak measured loading in this window",

    ratingKva,
    voltLL,
    ratedPhaseA: iRated,

    l1c: l1,
    l2c: l2,
    l3c: l3,
    neutralC: row.neutralC ?? null,
    kva: row.kva ?? null,
    kw: row.kw ?? null,
    pf: row.pf ?? null,
    thdPct: row.thdPct ?? null,
    avgVoltage: a.avgVoltage,

    meanPhaseA: mean,
    maxPhaseA: a.maxPhaseC,
    worstDeviationA,
    hottestPhase: a.hottestPhase,

    loadingPct: a.loadingPct,
    unbalancePct: a.unbalancePct,
    maxPhasePctRated: a.maxPhasePctRated,
    neutralPctRated: a.neutralPctRated,
    zeroSequenceA: a.zeroSequenceA,
    unbalanceLossFactor: a.unbalanceLossFactor,

    ambientC,
    constants: t.constants,
    constantsProvenance: resolved.provenance,
    lossRatioSource: t.lossRatioSource,

    topOilRiseK: t.topOilRiseK,
    topOilC: t.topOilC,
    hotSpotRiseK: t.hotspotRiseK,
    hotSpotC: t.hotspotC,
    ageingRate: t.ageingRate,
    thermalBand: t.band,
    hotSpotByPhaseC: tPhase.hotspotC,

    severity: a.severity,
  };
}

/**
 * The columns to persist so that alerts, scores and reports all read the same
 * number instead of recomputing it. Written on EmdisDataset and cached on
 * Transformer; see prisma/schema.patch.prisma.
 */
export function snapshotColumns(s: DerivedSnapshot) {
  return {
    snapshotAt: s.recordedAt,
    snapshotL1c: s.l1c,
    snapshotL2c: s.l2c,
    snapshotL3c: s.l3c,
    snapshotNeutralC: s.neutralC,
    snapshotKva: s.kva,
    snapshotLoadingPct: s.loadingPct,
    snapshotUnbalancePct: s.unbalancePct,
    snapshotMaxPhasePctRated: s.maxPhasePctRated,
    snapshotNeutralPctRated: s.neutralPctRated,
    snapshotAmbientC: s.ambientC,
    snapshotTopOilC: s.topOilC,
    snapshotHotSpotC: s.hotSpotC,
    snapshotAgeingRate: s.ageingRate,
  };
}

/**
 * A one-line audit string. Put this in the alert body and on the PDF: it makes
 * the number checkable by hand, which is the only reason anyone will believe it.
 */
export function snapshotArithmetic(s: DerivedSnapshot): string {
  return (
    "L1 " + s.l1c.toFixed(1) + " A, L2 " + s.l2c.toFixed(1) + " A, L3 " + s.l3c.toFixed(1) +
    " A; I_avg " + s.meanPhaseA.toFixed(1) + " A; worst deviation " + s.worstDeviationA.toFixed(1) +
    " A; unbalance " + s.unbalancePct.toFixed(2) + "%"
  );
}

/**
 * Sanity check between what was stored at ingest and what the formulas give
 * now. Any non-zero delta means a stored column is stale — a schema change, a
 * re-rating, or a code change that was never backfilled.
 */
export function snapshotDrift(row: SnapshotSourceRow, ratingKva: number, voltLL: number) {
  const recomputedUnbalance = nemaUnbalancePct(num(row.l1c), num(row.l2c), num(row.l3c));
  const recomputedLoading = row.kva != null ? (row.kva / ratingKva) * 100 : 0;
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const recomputedMaxPhasePct = (Math.max(num(row.l1c), num(row.l2c), num(row.l3c)) / iRated) * 100;
  return {
    unbalanceDelta: Math.abs(recomputedUnbalance - num(row.phaseUnbalancePct)),
    loadingDelta: Math.abs(recomputedLoading - num(row.loadingPct)),
    maxPhasePctDelta: Math.abs(recomputedMaxPhasePct - num(row.maxPhasePctRated)),
    recomputedUnbalance,
    recomputedLoading,
    recomputedMaxPhasePct,
    lossFactor: unbalanceLossFactorOf(num(row.l1c), num(row.l2c), num(row.l3c)),
  };
}

/** Severity band for an unbalance figure, so nobody re-derives the thresholds. */
export function unbalanceSeverity(pct: number): Severity {
  if (pct >= LIMITS.unbalanceCritical) return "CRITICAL";
  if (pct >= LIMITS.unbalanceWarn) return "WARNING";
  return "OK";
}
