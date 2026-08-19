/**
 * Thermal and loading analysis for an oil-immersed distribution transformer.
 *
 * IEC 60076-7, steady state:
 *
 *   top-oil rise      dOil = dOil,r x [(1 + R.K^2) / (1 + R)]^x
 *   hot-spot gradient dHs  = g_r x K^y
 *   hot-spot          Oh   = Oambient + dOil + dHs
 *   relative ageing   V    = 2^((Oh - 98) / 6)      (non-upgraded paper)
 *
 * K is the load factor in per unit. R, dOil,r, g_r, x and y are the five
 * constants, and they now come off the TRANSFORMER RECORD (manufacturer test
 * certificate) with IEC 60076-7 Table 4 as the fallback. See
 * ./thermal-constants.ts — including the naming note about x and y.
 *
 * WHAT CHANGED AND WHY IT MATTERS
 *
 * 1. R is no longer invented. It used to be derived from two DEFAULTED loss
 *    figures, which pinned it at 6.67 for every transformer in the fleet.
 *    It is now IEC's 5 unless the certificate says otherwise.
 * 2. The separate hot-spot factor H = 1.1 is gone. hotSpotGradientK is the
 *    full gradient as printed on the certificate; multiplying it again
 *    double-counted.
 * 3. The winding exponent is applied as K^y with y = 1.6, not K^(2m) with
 *    m = 0.8. Numerically identical for the default, but it is now the form
 *    the standard actually prints, so it can be checked against the book.
 *
 * The losses are still reported, because an engineer wants them, but they no
 * longer drive R unless they were genuinely supplied.
 */

import {
  resolveThermalConstants,
  type ThermalConstants,
  type ThermalConstantsRecord,
  type ResolvedThermalConstants,
} from "./thermal-constants";

export type ThermalParams = {
  /** Apparent power drawn, kVA. */
  loadKva: number;
  /** Nameplate rating, kVA. */
  ratingKva: number;
  /** Ambient air temperature, degC. */
  ambientC: number;
  /**
   * The transformer record. The five thermal constants are read from here;
   * anything null falls back to the IEC 60076-7 default.
   */
  transformer?: ThermalConstantsRecord | null;
  /** Already-resolved constants, when a caller resolved them once for a batch. */
  constants?: ThermalConstants | null;
  /** No-load (core) loss at rated voltage, W. Test certificate figure. */
  noLoadLossW?: number;
  /** Load (copper) loss at rated current, W. Test certificate figure. */
  loadLossW?: number;
  /** Measured power factor, used for the efficiency figure only. */
  powerFactor?: number;
};

export type ThermalBand = "NORMAL" | "WATCH" | "OVERLOAD" | "CRITICAL";

export type ThermalResult = {
  loadFactor: number;
  loadingPct: number;
  topOilRiseK: number;
  topOilC: number;
  hotspotRiseK: number;
  hotspotC: number;
  ageingRate: number;
  lossOfLifePerHour: number;
  noLoadLossW: number;
  loadLossW: number;
  totalLossesW: number;
  efficiencyPct: number;
  band: ThermalBand;
  headroomKva: number;
  findings: string[];
  /** The five constants this run actually used. Put them on the report. */
  constants: ThermalConstants;
  /** Where each constant came from, and a one-line provenance string. */
  constantsProvenance: string;
  /** Where R came from, which is the one an argument usually turns on. */
  lossRatioSource: "certificate constant" | "measured losses" | "IEC default";
  ambientC: number;
};

// IEC 60076-7 limits for normal cyclic loading of distribution transformers.
export const LIMIT_TOP_OIL_C = 105;
export const LIMIT_HOTSPOT_C = 120;
export const LIMIT_CURRENT_PU = 1.5;
/** The reference hot-spot temperature at which paper ages at its normal rate. */
export const REFERENCE_HOTSPOT_C = 98;

const f1 = (x: number) => x.toFixed(1);
const f0 = (x: number) => x.toFixed(0);
const f2 = (x: number) => x.toFixed(2);

/**
 * Top-oil rise at load factor K. Pulled out so a test can check this one
 * equation against the printed standard without building a whole result.
 */
export function topOilRiseAt(K: number, c: ThermalConstants): number {
  const ratio = (1 + c.lossRatioR * K * K) / (1 + c.lossRatioR);
  return c.topOilRiseK * Math.pow(Math.max(0, ratio), c.exponentX);
}

/** Hot-spot-to-top-oil gradient at load factor K. */
export function hotSpotGradientAt(K: number, c: ThermalConstants): number {
  return c.hotSpotGradientK * Math.pow(Math.max(0, K), c.exponentY);
}

/** IEC 60076-7 relative ageing rate for non-upgraded paper. */
export function ageingRateAt(hotspotC: number): number {
  return Math.pow(2, (hotspotC - REFERENCE_HOTSPOT_C) / 6);
}

export function computeThermal(p: ThermalParams): ThermalResult {
  const rating = Math.max(1, p.ratingKva);

  const resolved: ResolvedThermalConstants = resolveThermalConstants(p.transformer);
  // A caller may hand over constants it resolved once for a whole dataset.
  const c: ThermalConstants = p.constants ?? resolved.constants;

  // Losses are reported and used for efficiency. They drive R ONLY when both
  // were genuinely supplied AND the record carries no explicit loss ratio —
  // otherwise a defaulted loss pair would quietly override the certificate.
  const haveMeasuredLosses =
    p.noLoadLossW != null && p.noLoadLossW > 0 && p.loadLossW != null && p.loadLossW > 0;
  const P0 = haveMeasuredLosses ? p.noLoadLossW! : Math.round(rating * 2.4);
  const Pk = haveMeasuredLosses ? p.loadLossW! : Math.round(rating * 16);

  const recordGaveR = resolved.origin.lossRatioR === "record";
  let R = c.lossRatioR;
  let lossRatioSource: ThermalResult["lossRatioSource"] = recordGaveR
    ? "certificate constant"
    : "IEC default";
  if (!recordGaveR && haveMeasuredLosses) {
    R = Pk / Math.max(1, P0);
    lossRatioSource = "measured losses";
  }
  const used: ThermalConstants = { ...c, lossRatioR: R };

  const K = Math.max(0, p.loadKva) / rating;

  const topOilRiseK = topOilRiseAt(K, used);
  const topOilC = p.ambientC + topOilRiseK;
  const hotspotRiseK = hotSpotGradientAt(K, used);
  const hotspotC = topOilC + hotspotRiseK;
  const ageingRate = ageingRateAt(hotspotC);

  const loadLossW = Pk * K * K;
  const totalLossesW = P0 + loadLossW;

  const pf = p.powerFactor ?? 0.95;
  const outputW = Math.max(0, p.loadKva) * 1000 * pf;
  const efficiencyPct = outputW > 0 ? (outputW / (outputW + totalLossesW)) * 100 : 0;

  const findings: string[] = [];
  let band: ThermalBand = "NORMAL";

  if (K > 1.0) {
    band = "OVERLOAD";
    findings.push("Loaded to " + f1(K * 100) + " % of nameplate — above continuous rating.");
  } else if (K > 0.95) {
    band = "WATCH";
    findings.push("Loaded to " + f1(K * 100) + " % — approaching the continuous limit.");
  }

  if (hotspotC > LIMIT_HOTSPOT_C) {
    band = "CRITICAL";
    findings.push(
      "Hot-spot " + f0(hotspotC) + " degC exceeds the " + LIMIT_HOTSPOT_C +
      " degC limit for normal cyclic loading.",
    );
  } else if (hotspotC > 110) {
    if (band !== "OVERLOAD") band = "WATCH";
    findings.push("Hot-spot " + f0(hotspotC) + " degC is within limits but elevated.");
  }

  if (topOilC > LIMIT_TOP_OIL_C) {
    band = "CRITICAL";
    findings.push("Top-oil " + f0(topOilC) + " degC exceeds the " + LIMIT_TOP_OIL_C + " degC limit.");
  }

  if (ageingRate > 2) {
    findings.push(
      "Insulation ageing " + f1(ageingRate) + "x normal — one hour here costs " +
      f1(ageingRate) + " hours of life.",
    );
  }

  if (K > LIMIT_CURRENT_PU) {
    band = "CRITICAL";
    findings.push("Load " + f2(K) + " pu exceeds the " + LIMIT_CURRENT_PU + " pu emergency ceiling.");
  }

  if (findings.length === 0) {
    findings.push(
      "Operating normally. Hot-spot " + f0(hotspotC) + " degC, ageing at " + f2(ageingRate) + "x normal.",
    );
  }

  return {
    loadFactor: K,
    loadingPct: K * 100,
    topOilRiseK,
    topOilC,
    hotspotRiseK,
    hotspotC,
    ageingRate,
    lossOfLifePerHour: ageingRate,
    noLoadLossW: P0,
    loadLossW,
    totalLossesW,
    efficiencyPct,
    band,
    headroomKva: Math.max(0, rating - p.loadKva),
    findings,
    constants: used,
    constantsProvenance: resolved.provenance,
    lossRatioSource,
    ambientC: p.ambientC,
  };
}

/** A 0-100 condition score a manager can rank by. */
export function conditionScore(
  t: ThermalResult,
  avgVoltage: number,
  minVoltage: number,
  powerFactor: number,
): number {
  let score = 100;
  if (t.loadingPct > 100) score -= Math.min(35, (t.loadingPct - 100) * 1.8);
  else if (t.loadingPct > 80) score -= (t.loadingPct - 80) * 0.4;

  if (t.hotspotC > REFERENCE_HOTSPOT_C) score -= Math.min(30, (t.hotspotC - REFERENCE_HOTSPOT_C) * 1.4);
  // Kenyan LV nominal is 240 V single phase; +/-6 % is the statutory band.
  if (avgVoltage > 0 && avgVoltage < 225) score -= Math.min(15, (225 - avgVoltage) * 1.2);
  if (minVoltage > 0 && minVoltage < 210) score -= 10;
  if (powerFactor > 0 && powerFactor < 0.9) score -= Math.min(12, (0.9 - powerFactor) * 100);

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Maps a temperature onto the cutaway's thermal colour ramp. */
export function thermalColour(tempC: number): string {
  const stops: [number, string][] = [
    [30, "#1e40af"], [55, "#0e8a4f"], [75, "#a3c414"],
    [95, "#f5b700"], [110, "#e8590c"], [130, "#c02626"],
  ];
  if (tempC <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (tempC <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mix(c0, c1, (tempC - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const out = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}
