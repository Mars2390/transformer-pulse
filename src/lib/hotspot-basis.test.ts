import { describe, expect, it } from "vitest";
import { computeThermal, ageingRateAt } from "./transformer-thermal";
import { IEC_DEFAULTS } from "./thermal-constants";
import { ratedPhaseCurrent } from "./load-analysis";
import { deriveSnapshot } from "./analysis-snapshot";
import { lifeFromAgeing, NORMAL_LIFE_YEARS } from "./time-to-failure";

/**
 * The hot-spot is a property of ONE winding: the one carrying the most current.
 *
 * IEC 60076-7 takes K as that winding's current over rated current. kVA is a
 * three-phase aggregate, so on an unbalanced transformer it lands near the MEAN
 * of the phases and the hottest winding vanishes into the average. Driving the
 * thermal model off kVA therefore reports a temperature that is not the
 * temperature of any part of the transformer.
 *
 * These tests pin the basis with the real case that exposed it, G-153457, and
 * check the arithmetic against the standard rather than against the engine —
 * every expected number below is written out longhand first.
 */

// G-153457, snapshot 2026-01-13T20:20:55Z. 315 kVA, 415 V, January in Nairobi.
const RATING_KVA = 315;
const VOLT_LL = 415;
const AMBIENT_C = 26;
const L1 = 281.1;
const L2 = 534.4;
const L3 = 408.7;
/** kVA as the meter reported it at that instant: 88.20% of nameplate. */
const LOADING_PCT = 88.2;

const I_RATED = ratedPhaseCurrent(RATING_KVA, VOLT_LL);

/** IEC 60076-7 steady state, written out from the standard. */
function iecHotSpot(K: number, ambientC: number): number {
  const { lossRatioR: R, topOilRiseK, hotSpotGradientK, exponentX, exponentY } = IEC_DEFAULTS;
  const oilRise = topOilRiseK * Math.pow((1 + R * K * K) / (1 + R), exponentX);
  const gradient = hotSpotGradientK * Math.pow(K, exponentY);
  return ambientC + oilRise + gradient;
}

describe("rated phase current", () => {
  it("is S / (sqrt(3) x V_LL)", () => {
    expect(I_RATED).toBeCloseTo((315 * 1000) / (Math.sqrt(3) * 415), 9);
    expect(I_RATED).toBeCloseTo(438.2297, 4);
  });
});

describe("G-153457: the hot-spot follows the worst phase, not the kVA figure", () => {
  const kWorst = Math.max(L1, L2, L3) / I_RATED;
  const kKva = LOADING_PCT / 100;

  it("takes K from L2, the phase carrying the most current", () => {
    // L1 64.14%, L2 121.95%, L3 93.26%. Neither the mean nor the last-read.
    expect(L1 / I_RATED).toBeCloseTo(0.6414, 4);
    expect(L2 / I_RATED).toBeCloseTo(1.2195, 4);
    expect(L3 / I_RATED).toBeCloseTo(0.9326, 4);
    expect(kWorst).toBeCloseTo(1.2195, 4);
  });

  it("computes 129.82 degC on that K, checked against the standard longhand", () => {
    // top-oil rise = 55 x ((1 + 5 x 1.2195^2) / 6)^0.8 = 72.2308 K
    // gradient     = 23 x 1.2195^1.6                   = 31.5930 K
    // hot-spot     = 26 + 72.2308 + 31.5930            = 129.8239 degC
    const byHand = iecHotSpot(kWorst, AMBIENT_C);
    expect(byHand).toBeCloseTo(129.8239, 3);

    const engine = computeThermal({
      loadKva: kWorst * RATING_KVA,
      ratingKva: RATING_KVA,
      ambientC: AMBIENT_C,
      powerFactor: 0.95,
    });
    expect(engine.hotspotC).toBeCloseTo(byHand, 9);
    expect(engine.hotspotC.toFixed(2)).toBe("129.82");
  });

  it("is CRITICAL, because 129.82 degC is past the 120 degC IEC limit", () => {
    const engine = computeThermal({
      loadKva: kWorst * RATING_KVA, ratingKva: RATING_KVA, ambientC: AMBIENT_C, powerFactor: 0.95,
    });
    expect(engine.band).toBe("CRITICAL");
  });

  it("ages the paper 39.5x normal, and the rate follows the temperature", () => {
    const hs = iecHotSpot(kWorst, AMBIENT_C);
    // V = 2^((129.8239 - 98) / 6)
    expect(ageingRateAt(hs)).toBeCloseTo(39.5054, 3);
    expect(ageingRateAt(hs)).toBeCloseTo(Math.pow(2, (hs - 98) / 6), 9);
  });

  it("gives a time to failure that is exactly 30 y divided by that rate", () => {
    const rate = ageingRateAt(iecHotSpot(kWorst, AMBIENT_C));
    const life = lifeFromAgeing(rate);
    expect(life.yearsToEndOfLife).toBeCloseTo(NORMAL_LIFE_YEARS / rate, 9);
    expect(life.yearsToEndOfLife).toBeCloseTo(0.7594, 4);
  });

  it("shows what the kVA basis was reporting instead, and how far out it was", () => {
    // The bug. 91.51 degC reads as NORMAL and ageing BELOW normal, for a
    // transformer with a winding at 122% of rated current.
    const wrong = iecHotSpot(kKva, AMBIENT_C);
    expect(wrong).toBeCloseTo(91.5079, 3);
    expect(ageingRateAt(wrong)).toBeCloseTo(0.4724, 3);

    const right = iecHotSpot(kWorst, AMBIENT_C);
    expect(right - wrong).toBeCloseTo(38.3160, 3);
    // Understating the temperature by 38 K understates the ageing 84-fold.
    expect(ageingRateAt(right) / ageingRateAt(wrong)).toBeGreaterThan(80);
  });

  it("puts the kVA figure near the mean phase, which is why it hides the peak", () => {
    // Not an accident of this dataset: kVA is a three-phase sum, so it tracks
    // the average winding. That is precisely why it cannot carry a hot-spot.
    const meanK = (L1 + L2 + L3) / 3 / I_RATED;
    expect(meanK).toBeCloseTo(0.9312, 4);
    expect(Math.abs(kKva - meanK)).toBeLessThan(0.06);
    expect(kKva).toBeLessThan(kWorst);
  });
});

describe("the two bases agree when there is nothing to hide", () => {
  it("gives the same hot-spot for a perfectly balanced load", () => {
    // The fix must not move balanced transformers. With equal phases the
    // hottest winding IS the average winding, so both bases give one answer.
    const I = 350;
    const balancedKva = (Math.sqrt(3) * VOLT_LL * I) / 1000;
    const kPhase = I / I_RATED;
    const kKva = balancedKva / RATING_KVA;
    expect(kKva).toBeCloseTo(kPhase, 9);
    expect(iecHotSpot(kPhase, AMBIENT_C)).toBeCloseTo(iecHotSpot(kKva, AMBIENT_C), 9);
  });
});

describe("deriveSnapshot names the phase the heat is in", () => {
  const snap = deriveSnapshot({
    row: { recordedAt: new Date("2026-01-13T20:20:55Z"), l1c: L1, l2c: L2, l3c: L3, neutralC: 120, kva: 277.83 },
    ratingKva: RATING_KVA, voltLL: VOLT_LL, ambientC: AMBIENT_C,
  });

  it("reports the worst phase in amperes and by name", () => {
    expect(snap.maxPhaseA).toBeCloseTo(L2, 9);
    expect(snap.hottestPhase).toBe("L2");
    expect(snap.maxPhasePctRated).toBeCloseTo(121.945, 3);
  });

  it("carries both thermal bases, so neither can be read by accident", () => {
    // The hottest winding is the hot-spot; the kVA figure is what a
    // conventional report would print. Both present, both labelled.
    expect(snap.hotSpotByPhaseC).toBeCloseTo(129.8239, 3);
    expect(snap.ageingRateByPhase).toBeCloseTo(39.5054, 3);
    expect(snap.hotSpotC).toBeLessThan(snap.hotSpotByPhaseC);
    expect(snap.thermalBandByPhase).toBe("CRITICAL");
  });

  it("returns no phase label for an unloaded transformer", () => {
    const idle = deriveSnapshot({
      row: { recordedAt: new Date("2026-01-13T00:00:00Z"), l1c: 0, l2c: 0, l3c: 0, kva: 0 },
      ratingKva: RATING_KVA, voltLL: VOLT_LL, ambientC: AMBIENT_C,
    });
    expect(idle.hottestPhase).toBeNull();
  });
});
