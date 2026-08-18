import { describe, expect, it } from "vitest";

import {
  NOMINAL_VLL,
  type PhaseReading,
  analyseReading,
  ratedPhaseCurrent,
} from "./load-analysis";

/**
 * A 315 kVA unit on a 415 V secondary.
 *
 *   315000 / (sqrt(3) x 415) = 438.2297224 A per phase
 *
 * Hand-computed and pinned here, because every loading percentage the dashboard
 * shows is this number underneath: if it drifts, every phase percentage in the app
 * drifts with it silently.
 *
 * IT WAS PINNED WRONG. The literal read 438.2264, which works back to a sqrt(3) of
 * 1.7320639 — right in the fourth decimal place, wrong from the fifth. The
 * implementation was correct all along and this fixture failed it, which is the
 * most expensive kind of wrong test: it accuses working arithmetic, and the
 * temptation is to "fix" the code until the number agrees.
 *
 * Nine significant figures, checked against sqrt(3) to full double precision, and
 * still a literal rather than a re-implementation of the formula — a fixture that
 * computes the thing it is testing cannot catch the thing it is testing.
 */
const I_RATED_315 = 438.2297224;

const reading = (over: Partial<PhaseReading> = {}): PhaseReading => ({
  l1c: null,
  l2c: null,
  l3c: null,
  neutralC: null,
  l1nV: null,
  l2nV: null,
  l3nV: null,
  kva: null,
  kw: null,
  pf: null,
  thdPct: null,
  ...over,
});

describe("ratedPhaseCurrent", () => {
  it("matches the hand computation for 315 kVA at 415 V", () => {
    expect(ratedPhaseCurrent(315, 415)).toBeCloseTo(I_RATED_315, 3);
  });

  it("scales linearly with rating and inversely with voltage", () => {
    expect(ratedPhaseCurrent(630, 415)).toBeCloseTo(2 * I_RATED_315, 3);
    expect(ratedPhaseCurrent(315, 830)).toBeCloseTo(I_RATED_315 / 2, 3);
  });

  /**
   * The secondaryKv fallback.
   *
   * Most rows in the register have no secondary voltage recorded, and callers
   * substitute NOMINAL_VLL. That constant has to stay 415, because a wrong
   * denominator here does not fail loudly — it just reports every transformer as
   * more or less loaded than it is.
   */
  it("falls back to the Kenyan nominal 415 V", () => {
    expect(NOMINAL_VLL).toBe(415);
    expect(ratedPhaseCurrent(315, NOMINAL_VLL)).toBeCloseTo(I_RATED_315, 3);
  });
});

describe("analyseReading", () => {
  it("reads a perfectly balanced reading at nameplate as 100% and no unbalance", () => {
    const a = analyseReading(
      reading({ l1c: I_RATED_315, l2c: I_RATED_315, l3c: I_RATED_315 }),
      315,
      415,
    );
    expect(a.maxPhasePctRated).toBeCloseTo(100, 2);
    expect(a.unbalancePct).toBeCloseTo(0, 6);
    expect(a.meanPhaseC).toBeCloseTo(I_RATED_315, 3);
  });

  it("computes per-phase percentages and unbalance on an unbalanced reading", () => {
    // 300 / 200 / 100 A: mean 200, worst deviation 100, so 50% unbalance.
    const a = analyseReading(reading({ l1c: 300, l2c: 200, l3c: 100 }), 315, 415);
    expect(a.meanPhaseC).toBeCloseTo(200, 6);
    expect(a.maxPhaseC).toBe(300);
    expect(a.minPhaseC).toBe(100);
    expect(a.hottestPhase).toBe("L1");
    expect(a.unbalancePct).toBeCloseTo(50, 6);
    expect(a.maxPhasePctRated).toBeCloseTo((300 / I_RATED_315) * 100, 2);
  });

  it("treats a missing phase as zero rather than dropping it from the mean", () => {
    const a = analyseReading(reading({ l1c: 300, l2c: 300, l3c: null }), 315, 415);
    expect(a.phases).toEqual([300, 300, 0]);
    expect(a.meanPhaseC).toBeCloseTo(200, 6);
  });

  it("reports the neutral against rated current, not against the phases", () => {
    const a = analyseReading(
      reading({ l1c: 300, l2c: 200, l3c: 100, neutralC: 50 }),
      315,
      415,
    );
    expect(a.neutralPctRated).toBeCloseTo((50 / I_RATED_315) * 100, 2);
  });

  it("reports loading from kVA when the meter gave one", () => {
    const a = analyseReading(reading({ kva: 252 }), 315, 415);
    expect(a.loadingPct).toBeCloseTo(80, 6);
  });
});
