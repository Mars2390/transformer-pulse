/**
 * Three-phase load analysis for distribution transformers.
 *
 * The engineering claim this file has to earn: a transformer can be destroyed
 * while every headline number says it is fine. On KPLC substation 14537 the
 * kVA reading never passed 86% of nameplate, and a single phase ran at 121% of
 * its rated current for 149 minutes. One figure is reassuring, the other is the
 * one that ages the insulation.
 *
 * Every threshold below carries its source. An engineer who disagrees with a
 * number should be able to find where it came from and argue with it.
 *
 * ONE UNBALANCE NUMBER — read this before changing anything
 *
 * Current unbalance is a property of a SINGLE INSTANT. Three currents, one
 * mean, one deviation. It is not a median, not a 95th percentile and not a
 * peak-during-window, and the moment those three quantities are allowed to
 * circulate under the same label the system starts contradicting itself: the
 * API said 42.72%, the manager screen said 63.0% and the priority list said
 * 136%, all about the same transformer on the same day.
 *
 *     I_avg        = (I_L1 + I_L2 + I_L3) / 3
 *     unbalancePct = max(|I - I_avg|) / I_avg x 100          (NEMA MG-1 form)
 *
 * So: analyseDataset picks ONE reading — the SNAPSHOT — and every headline
 * figure in the system is taken from it. The snapshot is the reading at peak
 * loading, because that is the instant the transformer is under the most
 * stress and the instant an engineer is being asked to act on.
 *
 * loadingPct and unbalancePct therefore always come from the same row. The
 * spread across the window is still computed, because it is genuinely useful,
 * but it lives in unbalanceWindow and it is never quoted as "the unbalance".
 */

// Standards and limits

/**
 * Rated phase current for a three-phase transformer.
 *
 * I_rated = S / (sqrt3 x V_LL)
 *
 * 315 kVA at 415 V gives 438 A; 200 kVA gives 278 A. This is the single most
 * important number in the file, because every per-phase judgement is a ratio
 * against it.
 */
export const SQRT3 = Math.sqrt(3);

export function ratedPhaseCurrent(ratingKva: number, voltLL: number): number {
  return (ratingKva * 1000) / (SQRT3 * voltLL);
}

export const LIMITS = {
  /** Fraction of nameplate kVA. Standard utility practice. */
  loadWarn: 0.8,
  loadCritical: 1.0,

  /** Fraction of rated PHASE current — the figure the kVA number hides. */
  phaseWarn: 0.8,
  phaseCritical: 1.0,

  /**
   * Current unbalance, NEMA MG-1 form (max deviation from the mean / mean).
   * NEMA MG-1 derates machines from 1% VOLTAGE unbalance; current unbalance on
   * a distribution feeder is routinely larger, and utility practice treats 10%
   * as the point of investigation and 20% as a defect.
   */
  unbalanceWarn: 10,
  unbalanceCritical: 20,

  /**
   * Neutral current as a fraction of rated phase current. A balanced
   * three-phase load returns almost nothing through the neutral. This matters
   * more than it looks: neutral conductors are frequently sized below the
   * phases, so a neutral at half of phase rating may already be at its own.
   */
  neutralWarn: 0.25,
  neutralCritical: 0.5,

  /**
   * Total harmonic distortion, IEEE 519-2014. The EMDis export does not say
   * whether its THD channel is VOLTAGE or CURRENT distortion, and the two have
   * different limits, so both are shown and the reading is judged against both.
   */
  thdCurrentLimit: 5,
  thdVoltageLimit: 8,
  thdWarn: 5,
  thdCritical: 8,

  /**
   * Kenyan statutory supply tolerance: 415 V line-to-line and 240 V
   * line-to-neutral, both +/-6%.
   */
  voltageTolerancePct: 6,

  /** Below this, KPLC applies a power-factor penalty to commercial supplies. */
  powerFactorFloor: 0.9,

  /** IEC 60076-7 for normal cyclic loading of a distribution unit. */
  topOilC: 105,
  hotspotC: 120,
} as const;

export const NOMINAL_VLL = 415;
export const NOMINAL_VLN = 240;

export type Severity = "OK" | "WARNING" | "CRITICAL";

const worse = (a: Severity, b: Severity): Severity =>
  a === "CRITICAL" || b === "CRITICAL" ? "CRITICAL" : a === "WARNING" || b === "WARNING" ? "WARNING" : "OK";

/**
 * NEMA-form current unbalance for three phase currents, in per cent.
 *
 * The ONE definition. Every caller in the codebase — ingest, alerting, the
 * verification script, the balancing planner — comes through this function, so
 * there is exactly one place a disagreement about the formula can be settled.
 *
 * Returns 0 below 1 A mean: an unloaded transformer is not 200% unbalanced,
 * it is unloaded, and dividing by a near-zero mean produces noise that reads
 * like a defect.
 */
export function nemaUnbalancePct(l1: number, l2: number, l3: number): number {
  const p = [l1, l2, l3].map((x) => (x == null || !Number.isFinite(x) ? 0 : x));
  const mean = (p[0] + p[1] + p[2]) / 3;
  if (mean <= 1) return 0;
  return (Math.max(...p.map((x) => Math.abs(x - mean))) / mean) * 100;
}

/**
 * Extra copper loss caused purely by the imbalance.
 *
 * K_unbalance = (I1^2 + I2^2 + I3^2) / (3 x I_mean^2)
 *
 * Exact, not an approximation: losses go as I^2, so spreading the same total
 * current unevenly across three windings always costs more than sharing it.
 */
export function unbalanceLossFactorOf(l1: number, l2: number, l3: number): number {
  const p = [l1, l2, l3].map((x) => (x == null || !Number.isFinite(x) ? 0 : x));
  const mean = (p[0] + p[1] + p[2]) / 3;
  if (mean <= 1) return 1;
  return (p[0] ** 2 + p[1] ** 2 + p[2] ** 2) / (3 * mean ** 2);
}

// One reading

export type PhaseReading = {
  l1c: number | null;
  l2c: number | null;
  l3c: number | null;
  neutralC: number | null;
  l1nV: number | null;
  l2nV: number | null;
  l3nV: number | null;
  kva: number | null;
  kw: number | null;
  pf: number | null;
  thdPct: number | null;
};

export type ReadingAnalysis = {
  phases: number[];
  maxPhaseC: number;
  minPhaseC: number;
  meanPhaseC: number;
  /** Which phase is carrying the most — L1, L2 or L3. */
  hottestPhase: "L1" | "L2" | "L3" | null;

  maxPhasePctRated: number;
  loadingPct: number;

  /** NEMA-form current unbalance for THIS reading, per cent. */
  unbalancePct: number;

  /**
   * Zero-sequence current, I0 = I_N / 3.
   *
   * Measured, not inferred: the neutral carries three times the zero-sequence
   * component by definition in a four-wire system. Negative-sequence current
   * would need phase ANGLES, which this meter does not report, so it is not
   * claimed here.
   */
  zeroSequenceA: number | null;
  neutralPctRated: number | null;

  unbalanceLossFactor: number;

  avgVoltage: number | null;
  voltageDeviationPct: number | null;

  severity: Severity;
};

export function analyseReading(r: PhaseReading, ratingKva: number, voltLL: number): ReadingAnalysis {
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const phases = [r.l1c, r.l2c, r.l3c].map((x) => (x == null || !Number.isFinite(x) ? 0 : x));

  const maxPhaseC = Math.max(...phases);
  const minPhaseC = Math.min(...phases);
  const meanPhaseC = (phases[0] + phases[1] + phases[2]) / 3;

  const hottestPhase =
    maxPhaseC <= 0 ? null : (["L1", "L2", "L3"] as const)[phases.indexOf(maxPhaseC)];

  const unbalancePct = nemaUnbalancePct(phases[0], phases[1], phases[2]);
  const unbalanceLossFactor = unbalanceLossFactorOf(phases[0], phases[1], phases[2]);

  const volts = [r.l1nV, r.l2nV, r.l3nV].filter((v): v is number => v != null && v > 50);
  const avgVoltage = volts.length ? volts.reduce((s, v) => s + v, 0) / volts.length : null;

  const maxPhasePctRated = (maxPhaseC / iRated) * 100;
  const loadingPct = r.kva != null ? (r.kva / ratingKva) * 100 : 0;

  let severity: Severity = "OK";
  if (maxPhasePctRated >= LIMITS.phaseCritical * 100) severity = "CRITICAL";
  else if (maxPhasePctRated >= LIMITS.phaseWarn * 100) severity = "WARNING";
  if (unbalancePct >= LIMITS.unbalanceCritical) severity = worse(severity, "CRITICAL");
  else if (unbalancePct >= LIMITS.unbalanceWarn) severity = worse(severity, "WARNING");

  const neutralPctRated = r.neutralC != null ? (r.neutralC / iRated) * 100 : null;
  if (neutralPctRated != null) {
    if (neutralPctRated >= LIMITS.neutralCritical * 100) severity = worse(severity, "CRITICAL");
    else if (neutralPctRated >= LIMITS.neutralWarn * 100) severity = worse(severity, "WARNING");
  }

  return {
    phases,
    maxPhaseC,
    minPhaseC,
    meanPhaseC,
    hottestPhase,
    maxPhasePctRated,
    loadingPct,
    unbalancePct,
    zeroSequenceA: r.neutralC != null ? r.neutralC / 3 : null,
    neutralPctRated,
    unbalanceLossFactor,
    avgVoltage,
    voltageDeviationPct: avgVoltage != null ? ((avgVoltage - NOMINAL_VLN) / NOMINAL_VLN) * 100 : null,
    severity,
  };
}

// A whole dataset

export type Finding = {
  code: string;
  severity: Severity;
  headline: string;
  detail: string;
  /** What an engineer should actually do about it. */
  action: string;
};

/**
 * The single reading every headline figure is taken from.
 *
 * Chosen as the reading at PEAK LOADING. Loading and unbalance therefore
 * always describe the same instant, which is the whole point: an engineer can
 * put the three currents, the kVA and the resulting unbalance on one line of a
 * report and the arithmetic checks out by hand.
 */
export type AnalysisSnapshot = {
  /** Index into the time-sorted readings, so the raw row can be found again. */
  index: number;
  recordedAt: Date;
  l1c: number;
  l2c: number;
  l3c: number;
  neutralC: number | null;
  kva: number | null;
  kw: number | null;
  pf: number | null;
  thdPct: number | null;

  meanPhaseA: number;
  maxPhaseA: number;
  hottestPhase: "L1" | "L2" | "L3" | null;

  loadingPct: number;
  unbalancePct: number;
  maxPhasePctRated: number;
  neutralPctRated: number | null;
  zeroSequenceA: number | null;
  unbalanceLossFactor: number;
  avgVoltage: number | null;

  severity: Severity;
  /** Why this reading and not another. Goes on the report. */
  selectedBecause: string;
};

export type DatasetAnalysis = {
  ratingKva: number;
  voltLL: number;
  ratedPhaseA: number;
  readings: number;
  intervalSeconds: number;
  spanHours: number;

  /** THE snapshot. Everything headline-facing below is derived from it. */
  snapshot: AnalysisSnapshot;
  /** Same number as snapshot.loadingPct. Here so callers need not reach in. */
  loadingPct: number;
  /** Same number as snapshot.unbalancePct. THE unbalance figure. */
  unbalancePct: number;

  peakKva: number;
  peakLoadingPct: number;
  meanKva: number;

  perPhase: {
    name: "L1" | "L2" | "L3";
    peakA: number;
    meanA: number;
    peakPctRated: number;
    minutesOverRated: number;
  }[];

  peakPhaseA: number;
  peakPhasePctRated: number;
  minutesAnyPhaseOverRated: number;
  minutesAnyPhaseOver80: number;
  longestExcursionMinutes: number;

  /** The headline contradiction: phase over rating while kVA looked fine. */
  hiddenOverloadMinutes: number;

  /**
   * COMPATIBILITY SHIM. pct is the snapshot value, and median / p95 / max are
   * deliberately set to the SAME number so that no call site anywhere in the
   * application can quote a different unbalance from the API. The real spread
   * across the window is in unbalanceWindow.
   *
   * TODO: once every reader has moved to analysis.unbalancePct (see
   * PATCH-NOTES.md), delete median / p95 / max from this object.
   */
  unbalance: {
    pct: number;
    median: number;
    p95: number;
    max: number;
    minutesOver10: number;
    minutesOver20: number;
  };

  /** The honest distribution across the window. Context, never the headline. */
  unbalanceWindow: {
    medianPct: number;
    p95Pct: number;
    maxPct: number;
    minPct: number;
    minutesOver10: number;
    minutesOver20: number;
  };

  neutral: { medianA: number; maxA: number; medianPctRated: number; maxPctRated: number };
  thd: { median: number; p95: number; max: number; minutesOverLimit: number } | null;
  voltage: { min: number; mean: number; max: number; minutesOutOfTolerance: number } | null;
  powerFactor: { median: number; min: number; minutesBelowFloor: number } | null;

  energyKwh: number | null;
  loadFactorPct: number | null;

  meanUnbalanceLossFactor: number;

  hourly: { hour: number; meanKva: number; maxPhaseA: number }[];

  findings: Finding[];
  severity: Severity;
};

const quantile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : 0;

/**
 * Pick the snapshot reading.
 *
 * Peak loading wins. When no kVA channel was recorded at all — some exports
 * only carry currents — every loadingPct is 0, so fall back to the reading with
 * the highest phase current, which is the same instant by any other name.
 * Ties go to the LATER reading: if the same peak occurred twice, the more
 * recent one is the one an engineer is being asked about.
 */
export function pickSnapshotIndex(analyses: ReadingAnalysis[]): { index: number; reason: string } {
  if (!analyses.length) return { index: 0, reason: "no readings" };

  const anyKva = analyses.some((a) => a.loadingPct > 0);
  let best = 0;
  for (let i = 1; i < analyses.length; i++) {
    const key = anyKva ? analyses[i].loadingPct : analyses[i].maxPhaseC;
    const bestKey = anyKva ? analyses[best].loadingPct : analyses[best].maxPhaseC;
    if (key >= bestKey) best = i;
  }
  return {
    index: best,
    reason: anyKva
      ? "peak measured loading in this window"
      : "peak phase current in this window (no kVA channel in the export)",
  };
}

export function analyseDataset(
  readings: (PhaseReading & { recordedAt: Date; kwh?: number | null })[],
  ratingKva: number,
  voltLL: number,
  opts?: { fuseSizeA?: number | null },
): DatasetAnalysis {
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const sorted = [...readings].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  // Sampling interval, taken as the median gap so one dropout does not skew it.
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].recordedAt.getTime() - sorted[i - 1].recordedAt.getTime()) / 1000);
  }
  gaps.sort((a, b) => a - b);
  const intervalSeconds = gaps.length ? Math.round(quantile(gaps, 0.5)) : 60;
  const minutesPerReading = intervalSeconds / 60;

  const analyses = sorted.map((r) => analyseReading(r, ratingKva, voltLL));

  // THE snapshot. Selected once, here, and never recomputed downstream.
  const picked = pickSnapshotIndex(analyses);
  const sa = analyses[picked.index];
  const sr = sorted[picked.index];
  const snapshot: AnalysisSnapshot = {
    index: picked.index,
    recordedAt: sr.recordedAt,
    l1c: sa.phases[0],
    l2c: sa.phases[1],
    l3c: sa.phases[2],
    neutralC: sr.neutralC,
    kva: sr.kva,
    kw: sr.kw,
    pf: sr.pf,
    thdPct: sr.thdPct,
    meanPhaseA: sa.meanPhaseC,
    maxPhaseA: sa.maxPhaseC,
    hottestPhase: sa.hottestPhase,
    loadingPct: sa.loadingPct,
    unbalancePct: sa.unbalancePct,
    maxPhasePctRated: sa.maxPhasePctRated,
    neutralPctRated: sa.neutralPctRated,
    zeroSequenceA: sa.zeroSequenceA,
    unbalanceLossFactor: sa.unbalanceLossFactor,
    avgVoltage: sa.avgVoltage,
    severity: sa.severity,
    selectedBecause: picked.reason,
  };

  const kvas = sorted.map((r) => r.kva ?? 0);
  const peakKva = Math.max(0, ...kvas);
  const meanKva = kvas.length ? kvas.reduce((s, v) => s + v, 0) / kvas.length : 0;

  const perPhase = (["L1", "L2", "L3"] as const).map((name, i) => {
    const series = analyses.map((a) => a.phases[i]);
    const peakA = Math.max(0, ...series);
    return {
      name,
      peakA,
      meanA: series.length ? series.reduce((s, v) => s + v, 0) / series.length : 0,
      peakPctRated: (peakA / iRated) * 100,
      minutesOverRated: series.filter((v) => v > iRated).length * minutesPerReading,
    };
  });

  const overRated = analyses.filter((a) => a.maxPhaseC > iRated);
  const minutesAnyPhaseOverRated = overRated.length * minutesPerReading;
  const minutesAnyPhaseOver80 =
    analyses.filter((a) => a.maxPhaseC > iRated * LIMITS.phaseWarn).length * minutesPerReading;

  // The contradiction, counted precisely: a phase above its rating in the same
  // instant that total kVA was still inside the nameplate.
  const hiddenOverloadMinutes =
    analyses.filter((a) => a.maxPhaseC > iRated && a.loadingPct < 100).length * minutesPerReading;

  // Longest unbroken spell above rated current. Duration is what ages
  // insulation; a one-minute spike and a two-hour spell are not the same event.
  let run = 0, longestRun = 0;
  for (const a of analyses) {
    if (a.maxPhaseC > iRated) { run++; longestRun = Math.max(longestRun, run); }
    else run = 0;
  }

  const unb = analyses.map((a) => a.unbalancePct).sort((a, b) => a - b);
  const neutrals = sorted.map((r) => r.neutralC).filter((v): v is number => v != null).sort((a, b) => a - b);
  const thds = sorted.map((r) => r.thdPct).filter((v): v is number => v != null).sort((a, b) => a - b);
  const pfs = sorted.map((r) => r.pf).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  const vs = analyses.map((a) => a.avgVoltage).filter((v): v is number => v != null).sort((a, b) => a - b);

  const vLo = NOMINAL_VLN * (1 - LIMITS.voltageTolerancePct / 100);
  const vHi = NOMINAL_VLN * (1 + LIMITS.voltageTolerancePct / 100);

  const kwhs = sorted.map((r) => r.kwh).filter((v): v is number => v != null && v > 0);
  const energyKwh = kwhs.length >= 2 ? kwhs[kwhs.length - 1] - kwhs[0] : null;
  const spanHours = sorted.length >= 2
    ? (sorted[sorted.length - 1].recordedAt.getTime() - sorted[0].recordedAt.getTime()) / 3.6e6
    : 0;

  const loadFactorPct = peakKva > 0 ? (meanKva / peakKva) * 100 : null;

  const hourlyMap = new Map<number, { kva: number[]; maxA: number }>();
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i].recordedAt.getUTCHours();
    const e = hourlyMap.get(h) ?? { kva: [], maxA: 0 };
    e.kva.push(sorted[i].kva ?? 0);
    e.maxA = Math.max(e.maxA, analyses[i].maxPhaseC);
    hourlyMap.set(h, e);
  }
  const hourly = [...hourlyMap.entries()]
    .map(([hour, e]) => ({ hour, meanKva: e.kva.reduce((s, v) => s + v, 0) / e.kva.length, maxPhaseA: e.maxA }))
    .sort((a, b) => a.hour - b.hour);

  const meanUnbalanceLossFactor =
    analyses.length ? analyses.reduce((s, a) => s + a.unbalanceLossFactor, 0) / analyses.length : 1;

  const findings: Finding[] = [];
  const peakPhaseA = Math.max(...perPhase.map((p) => p.peakA));
  const peakPhasePctRated = (peakPhaseA / iRated) * 100;
  const worstPhase = perPhase.find((p) => p.peakA === peakPhaseA)!;

  if (peakPhasePctRated >= 100) {
    findings.push({
      code: "SINGLE_PHASE_OVERLOAD",
      severity: "CRITICAL",
      headline: "Phase " + worstPhase.name + " reached " + peakPhasePctRated.toFixed(0) + "% of rated current",
      detail:
        peakPhaseA.toFixed(0) + " A against a rated " + iRated.toFixed(0) + " A, for " +
        minutesAnyPhaseOverRated.toFixed(0) + " minutes in total and up to " +
        (longestRun * minutesPerReading).toFixed(0) + " minutes unbroken." +
        (hiddenOverloadMinutes > 0
          ? " For " + hiddenOverloadMinutes.toFixed(0) +
            " of those minutes the total kVA was still inside the nameplate, so no kVA-based report would have shown it."
          : ""),
      action: "Transfer single-phase load off this phase, or rebalance the LV feeder connections.",
    });
  } else if (peakPhasePctRated >= 80) {
    findings.push({
      code: "SINGLE_PHASE_HIGH",
      severity: "WARNING",
      headline: "Phase " + worstPhase.name + " peaked at " + peakPhasePctRated.toFixed(0) + "% of rated current",
      detail: peakPhaseA.toFixed(0) + " A against a rated " + iRated.toFixed(0) + " A.",
      action: "Watch this phase. Check the LV distribution board for uneven connection of single-phase loads.",
    });
  }

  // Unbalance finding, from the SNAPSHOT. Two decimals on purpose: this is the
  // number a reviewer checks with a calculator, and 43% does not reproduce.
  const snapUnb = snapshot.unbalancePct;
  if (snapUnb >= LIMITS.unbalanceWarn) {
    const arith =
      "At " + snapshot.recordedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC: L1 " +
      snapshot.l1c.toFixed(1) + " A, L2 " + snapshot.l2c.toFixed(1) + " A, L3 " +
      snapshot.l3c.toFixed(1) + " A. Mean " + snapshot.meanPhaseA.toFixed(1) +
      " A, worst deviation " + Math.max(
        Math.abs(snapshot.l1c - snapshot.meanPhaseA),
        Math.abs(snapshot.l2c - snapshot.meanPhaseA),
        Math.abs(snapshot.l3c - snapshot.meanPhaseA),
      ).toFixed(1) + " A, so " + snapUnb.toFixed(2) + "% (NEMA MG-1 form).";
    findings.push({
      code: "PHASE_UNBALANCE",
      severity: snapUnb >= LIMITS.unbalanceCritical ? "CRITICAL" : "WARNING",
      headline: "Current unbalance " + snapUnb.toFixed(2) + "% at peak load",
      detail:
        arith + " Utility practice treats 10% as the point of investigation and 20% as a defect. " +
        "The uneven split alone adds " + ((snapshot.unbalanceLossFactor - 1) * 100).toFixed(1) +
        "% to copper loss at this instant, because loss follows the square of current.",
      action: "Rebalance single-phase customers across the three phases. This is the cheapest intervention available.",
    });
  }

  if (neutrals.length) {
    const medN = quantile(neutrals, 0.5);
    const medNPct = (medN / iRated) * 100;
    const maxNPct = (neutrals[neutrals.length - 1] / iRated) * 100;
    if (medNPct >= LIMITS.neutralCritical * 100 || maxNPct >= 75) {
      findings.push({
        code: "NEUTRAL_CURRENT_HIGH",
        severity: "CRITICAL",
        headline: "Neutral carrying " + medNPct.toFixed(0) + "% of rated phase current, peaking at " + maxNPct.toFixed(0) + "%",
        detail:
          "A balanced three-phase load returns almost nothing through the neutral. Zero-sequence current is " +
          (medN / 3).toFixed(0) + " A. Neutral conductors are commonly sized below the phases, so this may " +
          "already be at the neutral's own limit.",
        action: "Check neutral conductor sizing and joint condition, then rebalance the phases.",
      });
    } else if (medNPct >= LIMITS.neutralWarn * 100) {
      findings.push({
        code: "NEUTRAL_CURRENT_HIGH",
        severity: "WARNING",
        headline: "Neutral carrying " + medNPct.toFixed(0) + "% of rated phase current",
        detail: "Zero-sequence current " + (medN / 3).toFixed(0) +
          " A — imbalance, and possibly triplen harmonics returning through the neutral.",
        action: "Rebalance phases; if the neutral stays high after balancing, investigate harmonics.",
      });
    }
  }

  const thdStats = thds.length
    ? {
        median: quantile(thds, 0.5),
        p95: quantile(thds, 0.95),
        max: thds[thds.length - 1],
        minutesOverLimit: thds.filter((t) => t > LIMITS.thdCritical).length * minutesPerReading,
      }
    : null;

  if (thdStats && thdStats.median > LIMITS.thdCurrentLimit) {
    const overBoth = thdStats.median > LIMITS.thdVoltageLimit;
    findings.push({
      code: "THD_HIGH",
      severity: overBoth ? "CRITICAL" : "WARNING",
      headline: "Harmonic distortion " + thdStats.median.toFixed(1) + "% median, peaking at " + thdStats.max.toFixed(1) + "%",
      detail:
        "THD type unconfirmed — showing both IEEE 519 limits: " + LIMITS.thdVoltageLimit +
        "% for voltage distortion below 1 kV, " + LIMITS.thdCurrentLimit +
        "% for current distortion on typical distribution. " +
        (overBoth
          ? "At " + thdStats.median.toFixed(1) + "% this exceeds BOTH, so it is out of tolerance whichever quantity the meter reports."
          : "At " + thdStats.median.toFixed(1) + "% this exceeds only the stricter current limit, so the verdict depends on which quantity this is.") +
        " Harmonics raise eddy-current loss in the windings, so the unit runs hotter than the load alone explains." +
        (thdStats.minutesOverLimit > 0
          ? " Above " + LIMITS.thdVoltageLimit + "% for " + thdStats.minutesOverLimit.toFixed(0) + " minutes."
          : ""),
      action:
        "Survey the connected non-linear load. Confirm with the metering team whether this channel is voltage or current distortion so the limit can be fixed to one value.",
    });
  }

  const voltage = vs.length
    ? {
        min: vs[0],
        mean: vs.reduce((s, v) => s + v, 0) / vs.length,
        max: vs[vs.length - 1],
        minutesOutOfTolerance: vs.filter((v) => v < vLo || v > vHi).length * minutesPerReading,
      }
    : null;

  if (voltage && voltage.min < vLo) {
    findings.push({
      code: "VOLTAGE_LOW",
      severity: voltage.min < NOMINAL_VLN * 0.9 ? "CRITICAL" : "WARNING",
      headline: "Supply fell to " + voltage.min.toFixed(0) + " V",
      detail: "Statutory tolerance is " + NOMINAL_VLN + " V +/-" + LIMITS.voltageTolerancePct + "%, so " +
        vLo.toFixed(0) + "-" + vHi.toFixed(0) + " V. Out of tolerance for " +
        voltage.minutesOutOfTolerance.toFixed(0) + " minutes.",
      action: "Check tap position and LV conductor sizing; sustained low volts at peak points to an overloaded feeder.",
    });
  }

  const powerFactor = pfs.length
    ? {
        median: quantile(pfs, 0.5),
        min: pfs[0],
        minutesBelowFloor: pfs.filter((p) => p < LIMITS.powerFactorFloor).length * minutesPerReading,
      }
    : null;

  if (powerFactor && powerFactor.median < LIMITS.powerFactorFloor) {
    findings.push({
      code: "POWER_FACTOR_LOW",
      severity: "WARNING",
      headline: "Power factor " + powerFactor.median.toFixed(2),
      detail: "Below the " + LIMITS.powerFactorFloor +
        " floor. Reactive current heats the transformer and the feeder while delivering no useful power.",
      action: "Identify uncorrected motor load and consider capacitor correction.",
    });
  }

  // Fuse coordination — only when the inspection register told us the size.
  if (opts?.fuseSizeA && opts.fuseSizeA > 0) {
    const pctFuse = (peakPhaseA / opts.fuseSizeA) * 100;
    if (pctFuse >= 100) {
      findings.push({
        code: "FUSE_EXCEEDED",
        severity: "CRITICAL",
        headline: "Peak phase current " + peakPhaseA.toFixed(0) + " A exceeds the " + opts.fuseSizeA + " A fuse",
        detail: "The protection will operate. This is an outage waiting for the next peak, not a theoretical risk.",
        action: "Rebalance or transfer load before the fuse clears it for you.",
      });
    } else if (pctFuse >= 80) {
      findings.push({
        code: "FUSE_APPROACHING",
        severity: "WARNING",
        headline: "Peak phase current is " + pctFuse.toFixed(0) + "% of the " + opts.fuseSizeA + " A fuse",
        detail: "Little margin left for a fault current or a cold-load pickup after an outage.",
        action: "Review fuse coordination against the measured peak.",
      });
    }
  }

  if (!findings.length) {
    findings.push({
      code: "HEALTHY",
      severity: "OK",
      headline: "No load defect found in this window",
      detail: "At peak load: " + snapshot.loadingPct.toFixed(2) + "% of nameplate, phase " +
        snapshot.maxPhasePctRated.toFixed(0) + "% of rated, unbalance " + snapUnb.toFixed(2) +
        "%, neutral within limits.",
      action: "No action. Continue routine monitoring.",
    });
  }

  const severity = findings.reduce<Severity>((s, f) => worse(s, f.severity), "OK");

  const windowMinutesOver10 = unb.filter((u) => u > 10).length * minutesPerReading;
  const windowMinutesOver20 = unb.filter((u) => u > 20).length * minutesPerReading;

  return {
    ratingKva,
    voltLL,
    ratedPhaseA: iRated,
    readings: sorted.length,
    intervalSeconds,
    spanHours,

    snapshot,
    loadingPct: snapshot.loadingPct,
    unbalancePct: snapshot.unbalancePct,

    peakKva,
    peakLoadingPct: (peakKva / ratingKva) * 100,
    meanKva,
    perPhase,
    peakPhaseA,
    peakPhasePctRated,
    minutesAnyPhaseOverRated,
    minutesAnyPhaseOver80,
    longestExcursionMinutes: longestRun * minutesPerReading,
    hiddenOverloadMinutes,

    // The shim. All four numbers are the same on purpose — see the type.
    unbalance: {
      pct: snapshot.unbalancePct,
      median: snapshot.unbalancePct,
      p95: snapshot.unbalancePct,
      max: snapshot.unbalancePct,
      minutesOver10: windowMinutesOver10,
      minutesOver20: windowMinutesOver20,
    },
    unbalanceWindow: {
      medianPct: quantile(unb, 0.5),
      p95Pct: quantile(unb, 0.95),
      maxPct: unb.length ? unb[unb.length - 1] : 0,
      minPct: unb.length ? unb[0] : 0,
      minutesOver10: windowMinutesOver10,
      minutesOver20: windowMinutesOver20,
    },

    neutral: {
      medianA: quantile(neutrals, 0.5),
      maxA: neutrals.length ? neutrals[neutrals.length - 1] : 0,
      medianPctRated: (quantile(neutrals, 0.5) / iRated) * 100,
      maxPctRated: neutrals.length ? (neutrals[neutrals.length - 1] / iRated) * 100 : 0,
    },
    thd: thdStats,
    voltage,
    powerFactor,
    energyKwh,
    loadFactorPct,
    meanUnbalanceLossFactor,
    hourly,
    findings: findings.sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : b.severity === "CRITICAL" ? 1 : a.severity === "WARNING" ? -1 : 1,
    ),
    severity,
  };
}

/**
 * The load to hand the thermal model, kVA.
 *
 * Driven by the SNAPSHOT, so the hot-spot on the report belongs to the same
 * instant as the loading and the unbalance beside it. Two views are available
 * and both are legitimate:
 *
 *   "loading"  K = kVA / rating          — what the meter's kVA channel says
 *   "phase"    K = I_max / I_rated       — where the hot-spot physically is
 *
 * "loading" is the default because it is the figure the rest of the report
 * quotes. "phase" is the honest worst case for an unbalanced unit and is shown
 * alongside it; the GAP between the two is itself the finding.
 */
export function thermalLoadKva(
  analysis: DatasetAnalysis,
  basis: "loading" | "phase" = "loading",
): number {
  const pct = basis === "phase" ? analysis.snapshot.maxPhasePctRated : analysis.snapshot.loadingPct;
  return (pct / 100) * analysis.ratingKva;
}
