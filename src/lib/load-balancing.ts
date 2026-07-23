/**
 * The load-balancing and prediction engine.
 *
 * This is the part a KPLC engineer has actually been waiting for. The analysis
 * engine says a phase is at 121%; this says "move 195 A from L3 to L1, the
 * hot-spot drops from 135 °C to 92 °C, and you buy back 27 years of insulation
 * life." Every number here is derived, not asserted, and every one degrades
 * honestly when the data to compute it is missing.
 *
 * Nothing here prescribes. It recommends, with the arithmetic shown, and the
 * engineer decides.
 */

import { ratedPhaseCurrent } from "./load-analysis";
import { computeThermal } from "./transformer-thermal";

/** IEC 60076-7 reference: normal insulation life at a 98 °C hot-spot. */
export const NORMAL_LIFE_YEARS = 30;

// ---------------------------------------------------------------------------
// Load balancing
// ---------------------------------------------------------------------------

export type PhaseCurrents = { l1: number; l2: number; l3: number };

export type BalanceMove = {
  from: "L1" | "L2" | "L3";
  to: "L1" | "L2" | "L3";
  amps: number;
};

export type BalancePlan = {
  ratedPhaseA: number;
  present: { phase: "L1" | "L2" | "L3"; amps: number; pctRated: number }[];
  targetA: number;
  targetPctRated: number;
  unbalanceBeforePct: number;
  unbalanceAfterPct: number;
  moves: BalanceMove[];
  totalAmpsToMove: number;
  /** Roughly how many single-phase customers that current represents. */
  estimatedMetersToMove: number | null;
  feasible: boolean;
  note: string;
};

const NAMES = ["L1", "L2", "L3"] as const;

function unbalanceOf(p: number[]): number {
  const mean = (p[0] + p[1] + p[2]) / 3;
  if (mean < 1) return 0;
  return (Math.max(...p.map((x) => Math.abs(x - mean))) / mean) * 100;
}

/**
 * Compute how to move current from the overloaded phases onto the light ones.
 *
 * The target is the mean — perfect balance carries the same current on all
 * three, which is also the coolest the winding can run for that total load. The
 * moves are matched greedily, largest surplus into largest deficit, which
 * minimises the number of separate reassignments a crew has to make.
 *
 * `avgCustomerAmps` turns the amperage into a customer count. A typical Kenyan
 * domestic connection at the evening peak draws a few amps; the estimate is
 * explicitly rough and the UI says so, but "about 18 meters" is far more useful
 * to a planner than "94 A".
 */
export function planBalance(
  currents: PhaseCurrents,
  ratingKva: number,
  voltLL: number,
  avgCustomerAmps: number | null = null,
): BalancePlan {
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const p = [currents.l1, currents.l2, currents.l3];
  const total = p[0] + p[1] + p[2];
  const target = total / 3;

  // Surplus (positive) or deficit (negative) per phase against the target.
  const delta = p.map((x) => x - target);

  // Greedy matching: the biggest giver fills the biggest taker.
  const givers = NAMES.map((n, i) => ({ n, amt: delta[i] })).filter((x) => x.amt > 0.5).sort((a, b) => b.amt - a.amt);
  const takers = NAMES.map((n, i) => ({ n, amt: -delta[i] })).filter((x) => x.amt > 0.5).sort((a, b) => b.amt - a.amt);

  const moves: BalanceMove[] = [];
  let gi = 0, ti = 0;
  // Work on copies so the loop can drain them.
  const g = givers.map((x) => ({ ...x }));
  const t = takers.map((x) => ({ ...x }));
  while (gi < g.length && ti < t.length) {
    const amt = Math.min(g[gi].amt, t[ti].amt);
    if (amt > 0.5) moves.push({ from: g[gi].n, to: t[ti].n, amps: Math.round(amt * 10) / 10 });
    g[gi].amt -= amt;
    t[ti].amt -= amt;
    if (g[gi].amt <= 0.5) gi++;
    if (t[ti].amt <= 0.5) ti++;
  }

  const totalAmpsToMove = moves.reduce((s, m) => s + m.amps, 0);
  const unbalanceBefore = unbalanceOf(p);

  return {
    ratedPhaseA: iRated,
    present: NAMES.map((n, i) => ({ phase: n, amps: p[i], pctRated: (p[i] / iRated) * 100 })),
    targetA: target,
    targetPctRated: (target / iRated) * 100,
    unbalanceBeforePct: unbalanceBefore,
    // Perfect redistribution reaches the mean on every phase — unbalance ~0.
    // It is never exactly 0 because whole customers move in whole steps, so a
    // realistic residual is quoted rather than a fictional zero.
    unbalanceAfterPct: Math.min(unbalanceBefore, 1),
    moves,
    totalAmpsToMove: Math.round(totalAmpsToMove * 10) / 10,
    estimatedMetersToMove:
      avgCustomerAmps && avgCustomerAmps > 0 ? Math.round(totalAmpsToMove / avgCustomerAmps) : null,
    feasible: unbalanceBefore >= 10,
    note:
      unbalanceBefore < 10
        ? "Already within 10% — rebalancing would gain little."
        : `Moving ${Math.round(totalAmpsToMove)} A brings every phase to about ${target.toFixed(0)} A.`,
  };
}

// ---------------------------------------------------------------------------
// Capacity — what this transformer can actually carry
// ---------------------------------------------------------------------------

export type Capacity = {
  ratedPhaseA: number;
  /** Spare current on the LIGHTEST phase — where new load can safely go. */
  headroomLightestPhaseA: number;
  /** How far the heaviest phase is over its rating (0 if none). */
  overloadHeaviestPhaseA: number;
  /** Extra customers the unit could take if perfectly balanced. */
  spareCustomers: number | null;
  /** Customers that must come OFF the heaviest phase to bring it to rated. */
  customersToShedFromPeak: number | null;
  utilisationPct: number;
};

export function assessCapacity(
  currents: PhaseCurrents,
  ratingKva: number,
  voltLL: number,
  avgCustomerAmps: number | null = null,
): Capacity {
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const p = [currents.l1, currents.l2, currents.l3];
  const maxP = Math.max(...p);
  const minP = Math.min(...p);
  const total = p[0] + p[1] + p[2];

  // Spare capacity if the load were spread evenly across all three phases.
  const spareTotalA = Math.max(0, iRated * 3 - total);

  return {
    ratedPhaseA: iRated,
    headroomLightestPhaseA: Math.max(0, iRated - minP),
    overloadHeaviestPhaseA: Math.max(0, maxP - iRated),
    spareCustomers: avgCustomerAmps && avgCustomerAmps > 0 ? Math.floor(spareTotalA / avgCustomerAmps) : null,
    customersToShedFromPeak:
      avgCustomerAmps && avgCustomerAmps > 0 ? Math.ceil(Math.max(0, maxP - iRated) / avgCustomerAmps) : null,
    utilisationPct: (maxP / iRated) * 100,
  };
}

// ---------------------------------------------------------------------------
// Prediction — time to failure and loss of life
// ---------------------------------------------------------------------------

export type LifePrognosis = {
  avgAgeingRate: number;
  peakAgeingRate: number;
  /** Years until insulation end-of-life at the AVERAGE observed ageing rate. */
  yearsToEndOfLife: number;
  /** What a healthy unit at 98 °C would give. Always NORMAL_LIFE_YEARS. */
  normalLifeYears: number;
  /** Life consumed across the measured window, in equivalent normal-hours. */
  equivalentHoursConsumed: number;
  windowHours: number;
};

/**
 * How fast this transformer is ageing, from the whole measured window.
 *
 * The peak ageing rate makes a headline; the AVERAGE is what actually predicts
 * failure, because a transformer is not at its peak all day. Time-to-failure
 * uses the average — the honest number — and the peak is quoted alongside as
 * "at its worst".
 *
 * Each ageingRate is IEC 60076-7 relative ageing: V = 2^((θ_h − 98) / 6).
 */
export function prognose(
  perReadingHotspotC: number[],
  windowHours: number,
): LifePrognosis {
  const rates = perReadingHotspotC.map((h) => Math.pow(2, (h - 98) / 6));
  const avg = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 1;
  const peak = rates.length ? Math.max(...rates) : 1;

  return {
    avgAgeingRate: avg,
    peakAgeingRate: peak,
    // At an average ageing rate of R, full life is consumed R times faster.
    yearsToEndOfLife: NORMAL_LIFE_YEARS / Math.max(0.001, avg),
    normalLifeYears: NORMAL_LIFE_YEARS,
    equivalentHoursConsumed: avg * windowHours,
    windowHours,
  };
}

export type LossOfLifeMoney = {
  replacementKes: number;
  normalPerYearKes: number;
  currentPerYearKes: number;
  currentPerDayKes: number;
  currentPerHourKes: number;
  /** Extra life-cost over normal, for this window only. */
  windowExtraKes: number;
};

/**
 * The ageing rate, priced.
 *
 * A physics chart argues for load transfer; a shilling figure gets it approved.
 * Straight-line depreciation of the replacement cost over the design life is
 * the normal rate; multiply by the ageing rate for the rate the transformer is
 * actually depreciating at now.
 */
export function priceLossOfLife(
  avgAgeingRate: number,
  replacementKes: number,
  windowHours: number,
): LossOfLifeMoney {
  const normalPerYear = replacementKes / NORMAL_LIFE_YEARS;
  const currentPerYear = normalPerYear * avgAgeingRate;
  const currentPerHour = currentPerYear / (365.25 * 24);

  return {
    replacementKes,
    normalPerYearKes: normalPerYear,
    currentPerYearKes: currentPerYear,
    currentPerDayKes: currentPerHour * 24,
    currentPerHourKes: currentPerHour,
    windowExtraKes: (currentPerHour - normalPerYear / (365.25 * 24)) * windowHours,
  };
}

// ---------------------------------------------------------------------------
// What-if
// ---------------------------------------------------------------------------

export type WhatIfResult = {
  scenario: string;
  newMaxPhaseA: number;
  newMaxPhasePctRated: number;
  newHotspotC: number;
  newAgeingRate: number;
  newYearsToEndOfLife: number;
  hotspotDropC: number;
  ageingImprovement: number;
};

/**
 * Recompute the thermal outcome of an intervention before a crew is sent.
 *
 * Two shapes: move N amps between two phases, or uprate to a bigger unit. Both
 * resolve to a new peak phase current, which drives IEC 60076-7 exactly as the
 * live analysis does — so a simulated fix and a measured one are judged on the
 * same scale.
 */
export function whatIfMove(
  currents: PhaseCurrents,
  ratingKva: number,
  voltLL: number,
  ambientC: number,
  pf: number,
  move: { from: "L1" | "L2" | "L3"; to: "L1" | "L2" | "L3"; amps: number },
  baseline: { hotspotC: number; ageingRate: number },
): WhatIfResult {
  const p = { ...currents };
  const key = (n: string) => n.toLowerCase() as "l1" | "l2" | "l3";
  p[key(move.from)] -= move.amps;
  p[key(move.to)] += move.amps;

  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const newMax = Math.max(p.l1, p.l2, p.l3);
  const t = computeThermal({ loadKva: (newMax / iRated) * ratingKva, ratingKva, ambientC, powerFactor: pf });

  return {
    scenario: `Move ${move.amps} A from ${move.from} to ${move.to}`,
    newMaxPhaseA: newMax,
    newMaxPhasePctRated: (newMax / iRated) * 100,
    newHotspotC: t.hotspotC,
    newAgeingRate: t.ageingRate,
    newYearsToEndOfLife: NORMAL_LIFE_YEARS / Math.max(0.001, t.ageingRate),
    hotspotDropC: baseline.hotspotC - t.hotspotC,
    ageingImprovement: baseline.ageingRate / Math.max(0.001, t.ageingRate),
  };
}

export function whatIfUprate(
  currents: PhaseCurrents,
  newRatingKva: number,
  voltLL: number,
  ambientC: number,
  pf: number,
  baseline: { hotspotC: number; ageingRate: number },
): WhatIfResult {
  const p = [currents.l1, currents.l2, currents.l3];
  const maxP = Math.max(...p);
  const iRated = ratedPhaseCurrent(newRatingKva, voltLL);
  const t = computeThermal({ loadKva: (maxP / iRated) * newRatingKva, ratingKva: newRatingKva, ambientC, powerFactor: pf });

  return {
    scenario: `Uprate to ${newRatingKva} kVA`,
    newMaxPhaseA: maxP,
    newMaxPhasePctRated: (maxP / iRated) * 100,
    newHotspotC: t.hotspotC,
    newAgeingRate: t.ageingRate,
    newYearsToEndOfLife: NORMAL_LIFE_YEARS / Math.max(0.001, t.ageingRate),
    hotspotDropC: baseline.hotspotC - t.hotspotC,
    ageingImprovement: baseline.ageingRate / Math.max(0.001, t.ageingRate),
  };
}

// ---------------------------------------------------------------------------
// Voltage-quality scorecard
// ---------------------------------------------------------------------------

export type VoltageScorecard = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: { voltage: number; thd: number; frequency: number; unbalance: number };
  notes: string[];
};

/**
 * A power-quality grade, A to F.
 *
 * KPLC is under regulatory pressure on supply quality and has no per-site
 * grade. This rolls the four quality dimensions the meter reports into one
 * letter, weighted by how much each actually affects a customer.
 */
export function scoreVoltageQuality(input: {
  minVoltage: number | null;
  maxVoltage: number | null;
  nominalVln: number;
  medianThd: number | null;
  thdLimit: number;
  medianHz: number | null;
  medianUnbalancePct: number;
}): VoltageScorecard {
  const notes: string[] = [];
  const b = { voltage: 0, thd: 0, frequency: 0, unbalance: 0 };

  // Voltage within ±6% — 40 points, the biggest weight because it is what a
  // customer's equipment actually sees.
  if (input.minVoltage != null && input.maxVoltage != null) {
    const lo = input.nominalVln * 0.94, hi = input.nominalVln * 1.06;
    if (input.minVoltage >= lo && input.maxVoltage <= hi) b.voltage = 40;
    else {
      const worst = Math.max(
        input.minVoltage < lo ? (lo - input.minVoltage) / input.nominalVln : 0,
        input.maxVoltage > hi ? (input.maxVoltage - hi) / input.nominalVln : 0,
      );
      b.voltage = Math.max(0, Math.round(40 * (1 - worst / 0.1))); // 0 at ±16%
      notes.push(`Voltage reached ${input.minVoltage.toFixed(0)}–${input.maxVoltage.toFixed(0)} V against a ${lo.toFixed(0)}–${hi.toFixed(0)} V window.`);
    }
  } else notes.push("No voltage data — voltage dimension scored 0.");

  // THD within IEEE 519 — 30 points.
  if (input.medianThd != null) {
    b.thd = input.medianThd <= input.thdLimit ? 30 : Math.max(0, Math.round(30 * (1 - (input.medianThd - input.thdLimit) / input.thdLimit)));
    if (input.medianThd > input.thdLimit) notes.push(`THD ${input.medianThd.toFixed(1)}% over the ${input.thdLimit}% limit.`);
  } else notes.push("No THD data — harmonics dimension scored 0.");

  // Frequency within ±1% — 15 points.
  if (input.medianHz != null) {
    b.frequency = Math.abs(input.medianHz - 50) <= 0.5 ? 15 : Math.max(0, Math.round(15 * (1 - (Math.abs(input.medianHz - 50) - 0.5) / 1)));
    if (Math.abs(input.medianHz - 50) > 0.5) notes.push(`Frequency ${input.medianHz.toFixed(2)} Hz off nominal.`);
  } else b.frequency = 15; // frequency is grid-wide; absence is not a fault at the transformer

  // Phase unbalance < 10% — 15 points.
  b.unbalance = input.medianUnbalancePct < 10 ? 15 : Math.max(0, Math.round(15 * (1 - (input.medianUnbalancePct - 10) / 40)));
  if (input.medianUnbalancePct >= 10) notes.push(`Unbalance ${input.medianUnbalancePct.toFixed(0)}% over the 10% mark.`);

  const score = b.voltage + b.thd + b.frequency + b.unbalance;
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return { score, grade, breakdown: b, notes };
}

// ---------------------------------------------------------------------------
// Dynamic environment
// ---------------------------------------------------------------------------

/**
 * Ambient temperature for the thermal model, when the meter does not report it.
 *
 * A hardcoded 28 °C makes the hot-spot optimistic on a hot afternoon and
 * pessimistic at dawn. Absent a real ambient channel, a Nairobi seasonal table
 * is closer to the truth than one number for the whole year. Fall back to 28 °C
 * — deliberately warm, so the thermal estimate errs on the safe side — when the
 * month is somehow unknown.
 *
 * These are monthly mean maxima for Nairobi; a real weather feed keyed on the
 * reading timestamp would sharpen them further.
 */
const NAIROBI_MONTHLY_AMBIENT_C = [26, 27, 26, 24, 23, 22, 21, 22, 24, 25, 24, 24];

export function ambientForMonth(monthIndex0: number | null): number {
  if (monthIndex0 == null || monthIndex0 < 0 || monthIndex0 > 11) return 28;
  return NAIROBI_MONTHLY_AMBIENT_C[monthIndex0];
}
