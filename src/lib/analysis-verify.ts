/**
 * Manual versus system.
 *
 * The claim being tested is not "the code runs". It is "an engineer with a
 * calculator, the IEC 60076-7 text and the raw amps off the meter gets the same
 * numbers the system prints". So this file recomputes everything LONGHAND, with
 * a deliberately independent implementation — no imports from the analysis
 * engine, nothing shared that could hide a common mistake — and diffs the two.
 *
 * If the engine is refactored and this file still passes, the refactor was
 * safe. If someone reintroduces a window median under the name "unbalance",
 * this fails on the spot.
 *
 * Run it over real data with scripts/verify-analysis.mts.
 */

import type { DerivedSnapshot } from "./analysis-snapshot";
import type { ThermalConstants } from "./thermal-constants";

export type VerifyRow = {
  quantity: string;
  formula: string;
  manual: number;
  system: number;
  unit: string;
  /** Absolute difference. */
  delta: number;
  /** Tolerance this row was judged against. */
  tolerance: number;
  ok: boolean;
};

export type VerifyReport = {
  label: string;
  recordedAt: string;
  rows: VerifyRow[];
  allOk: boolean;
  failures: VerifyRow[];
  /** The constants used, and where they came from. */
  constants: ThermalConstants;
  constantsProvenance: string;
};

/** The raw meter reading, as it sits in the file before anything is derived. */
export type ManualInput = {
  label: string;
  l1A: number;
  l2A: number;
  l3A: number;
  neutralA: number | null;
  kva: number | null;
  ratingKva: number;
  voltLL: number;
  ambientC: number;
};

/**
 * Longhand recomputation. Written to be read next to the standard, not to be
 * fast or clever. Every intermediate is named the way the textbook names it.
 */
export function manualCompute(m: ManualInput, c: ThermalConstants) {
  // Rated phase current, I_rated = S / (sqrt(3) . V_LL)
  const sqrt3 = 1.7320508075688772;
  const iRated = (m.ratingKva * 1000) / (sqrt3 * m.voltLL);

  // NEMA MG-1 current unbalance
  const iAvg = (m.l1A + m.l2A + m.l3A) / 3;
  const d1 = Math.abs(m.l1A - iAvg);
  const d2 = Math.abs(m.l2A - iAvg);
  const d3 = Math.abs(m.l3A - iAvg);
  const worstDeviation = Math.max(d1, d2, d3);
  const unbalancePct = iAvg <= 1 ? 0 : (worstDeviation / iAvg) * 100;

  // Loading and per-phase percentage
  const iMax = Math.max(m.l1A, m.l2A, m.l3A);
  const loadingPct = m.kva == null ? 0 : (m.kva / m.ratingKva) * 100;
  const maxPhasePctRated = (iMax / iRated) * 100;
  const neutralPctRated = m.neutralA == null ? null : (m.neutralA / iRated) * 100;

  // Extra copper loss from the imbalance
  const lossFactor =
    iAvg <= 1 ? 1 : (m.l1A ** 2 + m.l2A ** 2 + m.l3A ** 2) / (3 * iAvg ** 2);

  // IEC 60076-7 steady state, on the SAME loading the report quotes
  const K = loadingPct / 100;
  const oilRatio = (1 + c.lossRatioR * K * K) / (1 + c.lossRatioR);
  const topOilRiseK = c.topOilRiseK * Math.pow(oilRatio, c.exponentX);
  const topOilC = m.ambientC + topOilRiseK;
  const hotSpotRiseK = c.hotSpotGradientK * Math.pow(K, c.exponentY);
  const hotSpotC = topOilC + hotSpotRiseK;
  const ageingRate = Math.pow(2, (hotSpotC - 98) / 6);

  return {
    iRated, iAvg, worstDeviation, unbalancePct, iMax, loadingPct,
    maxPhasePctRated, neutralPctRated, lossFactor,
    K, oilRatio, topOilRiseK, topOilC, hotSpotRiseK, hotSpotC, ageingRate,
  };
}

const TOL = {
  amps: 0.05,
  pct: 0.005,
  kelvin: 0.005,
  ratio: 0.0005,
  ageing: 0.05,
};

/**
 * Compare a stored/derived snapshot against the longhand arithmetic.
 *
 * Tolerances are tight on purpose. These are the same equations evaluated
 * twice; anything beyond floating-point noise means the two implementations
 * disagree, which is exactly what we are looking for.
 */
export function verifySnapshot(m: ManualInput, s: DerivedSnapshot): VerifyReport {
  const c = s.constants;
  const man = manualCompute(m, c);

  const rows: VerifyRow[] = [
    row("Rated phase current", "S / (sqrt3 . V_LL)", man.iRated, s.ratedPhaseA, "A", TOL.amps),
    row("I_avg", "(I_L1 + I_L2 + I_L3) / 3", man.iAvg, s.meanPhaseA, "A", TOL.amps),
    row("Worst deviation", "max(|I - I_avg|)", man.worstDeviation, s.worstDeviationA, "A", TOL.amps),
    row("Unbalance (NEMA MG-1)", "max(|I - I_avg|) / I_avg x 100", man.unbalancePct, s.unbalancePct, "%", TOL.pct),
    row("Loading", "kVA / rating x 100", man.loadingPct, s.loadingPct, "%", TOL.pct),
    row("Worst phase vs rated", "I_max / I_rated x 100", man.maxPhasePctRated, s.maxPhasePctRated, "%", TOL.pct),
    row("Unbalance loss factor", "(sum I^2) / (3 . I_avg^2)", man.lossFactor, s.unbalanceLossFactor, "x", TOL.ratio),
    row("Top-oil rise", "dOil,r . [(1+R.K^2)/(1+R)]^x", man.topOilRiseK, s.topOilRiseK, "K", TOL.kelvin),
    row("Top-oil temperature", "ambient + top-oil rise", man.topOilC, s.topOilC, "degC", TOL.kelvin),
    row("Hot-spot gradient", "g_r . K^y", man.hotSpotRiseK, s.hotSpotRiseK, "K", TOL.kelvin),
    row("Hot-spot temperature", "ambient + oil rise + gradient", man.hotSpotC, s.hotSpotC, "degC", TOL.kelvin),
    row("Relative ageing", "2^((Oh - 98)/6)", man.ageingRate, s.ageingRate, "x", TOL.ageing),
  ];

  if (man.neutralPctRated != null && s.neutralPctRated != null) {
    rows.push(row("Neutral vs rated phase", "I_N / I_rated x 100", man.neutralPctRated, s.neutralPctRated, "%", TOL.pct));
  }

  const failures = rows.filter((r) => !r.ok);
  return {
    label: m.label,
    recordedAt: s.recordedAt.toISOString(),
    rows,
    allOk: failures.length === 0,
    failures,
    constants: c,
    constantsProvenance: s.constantsProvenance,
  };
}

function row(
  quantity: string,
  formula: string,
  manual: number,
  system: number,
  unit: string,
  tolerance: number,
): VerifyRow {
  const delta = Math.abs(manual - system);
  return { quantity, formula, manual, system, unit, delta, tolerance, ok: delta <= tolerance };
}

/** A fixed-width table for a terminal or a CI log. */
export function formatVerifyReport(r: VerifyReport): string {
  const lines: string[] = [];
  const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
  const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

  lines.push("MANUAL vs SYSTEM — " + r.label);
  lines.push("Snapshot reading: " + r.recordedAt);
  lines.push("Constants: R=" + r.constants.lossRatioR + ", dOil,r=" + r.constants.topOilRiseK +
    " K, g_r=" + r.constants.hotSpotGradientK + " K, x=" + r.constants.exponentX +
    ", y=" + r.constants.exponentY);
  lines.push(r.constantsProvenance);
  lines.push("");
  lines.push(pad("QUANTITY", 26) + pad("FORMULA", 34) + padL("MANUAL", 13) + padL("SYSTEM", 13) + padL("DELTA", 12) + "  ");
  lines.push("-".repeat(104));
  for (const x of r.rows) {
    lines.push(
      pad(x.quantity, 26) +
      pad(x.formula, 34) +
      padL(x.manual.toFixed(4) + " " + x.unit, 13) +
      padL(x.system.toFixed(4) + " " + x.unit, 13) +
      padL(x.delta.toExponential(1), 12) +
      "  " + (x.ok ? "MATCH" : "MISMATCH"),
    );
  }
  lines.push("-".repeat(104));
  lines.push(r.allOk
    ? "RESULT: manual == system on all " + r.rows.length + " quantities."
    : "RESULT: " + r.failures.length + " of " + r.rows.length + " quantities DISAGREE.");
  return lines.join("\n");
}
