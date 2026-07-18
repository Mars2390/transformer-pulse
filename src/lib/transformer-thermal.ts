/**
 * Thermal and loading analysis for an oil-immersed distribution transformer.
 *
 * The formulas below are the steady-state model from IEC 60076-7, the loading
 * guide for oil-immersed power transformers. They are not invented for this
 * demo — an engineer can check them against the standard:
 *
 *   Top-oil rise      ΔΘ_oil = ΔΘ_oil,r · [(1 + R·K²) / (1 + R)]^n
 *   Hot-spot gradient ΔΘ_h   = H · g_r · K^(2m)
 *   Hot-spot temp     Θ_h    = Θ_ambient + ΔΘ_oil + ΔΘ_h
 *   Relative ageing   V      = 2^((Θ_h − 98) / 6)          (non-upgraded paper)
 *
 * where K is the load factor in per-unit, R the ratio of load loss to no-load
 * loss at rated, n the oil exponent and m the winding exponent (both 0.8 for
 * ONAN), H the hot-spot factor.
 *
 * IMPORTANT — the defaults below are typical values for a distribution unit of
 * this class, not measurements from a specific transformer. Real no-load and
 * load losses come from the manufacturer's test certificate, and the top-oil
 * rise from the nameplate. Substitute those before any of this is used for an
 * operational decision.
 */

export type ThermalParams = {
  /** Apparent power drawn, kVA. */
  loadKva: number;
  /** Nameplate rating, kVA. */
  ratingKva: number;
  /** Ambient air temperature, °C. */
  ambientC: number;
  /** No-load (core) loss at rated voltage, W. */
  noLoadLossW?: number;
  /** Load (copper) loss at rated current, W. */
  loadLossW?: number;
  /** Top-oil rise over ambient at rated load, K. Nameplate figure. */
  topOilRiseRatedK?: number;
  /** Winding-to-oil gradient at rated load, K. */
  hotspotGradientK?: number;
  /** Oil exponent n — 0.8 for ONAN distribution units. */
  oilExponent?: number;
  /** Winding exponent m — 0.8 for ONAN. */
  windingExponent?: number;
  /** Hot-spot factor H — 1.1 for distribution transformers. */
  hotspotFactor?: number;
  /** Measured power factor, used for the efficiency figure. */
  powerFactor?: number;
};

export type ThermalBand = "NORMAL" | "WATCH" | "OVERLOAD" | "CRITICAL";

export type ThermalResult = {
  loadFactor: number; // K, per unit
  loadingPct: number;
  topOilRiseK: number;
  topOilC: number;
  hotspotRiseK: number;
  hotspotC: number;
  /** Relative ageing rate: 1.0 is normal life, 2.0 is ageing twice as fast. */
  ageingRate: number;
  /** Hours of insulation life consumed per hour at this temperature. */
  lossOfLifePerHour: number;
  noLoadLossW: number;
  loadLossW: number;
  totalLossesW: number;
  efficiencyPct: number;
  band: ThermalBand;
  headroomKva: number;
  findings: string[];
};

// IEC 60076-7 limits for normal cyclic loading of distribution transformers.
export const LIMIT_TOP_OIL_C = 105;
export const LIMIT_HOTSPOT_C = 120;
export const LIMIT_CURRENT_PU = 1.5;
/** The reference hot-spot temperature at which paper ages at its normal rate. */
export const REFERENCE_HOTSPOT_C = 98;

export function computeThermal(p: ThermalParams): ThermalResult {
  const rating = Math.max(1, p.ratingKva);

  // Typical values for an oil-immersed distribution unit. Scaled from the
  // rating so a 50 kVA and a 500 kVA unit both get sensible defaults.
  const P0 = p.noLoadLossW ?? Math.round(rating * 2.4); // ~0.24 % of rating
  const Pk = p.loadLossW ?? Math.round(rating * 16); // ~1.6 % of rating
  const dOilRated = p.topOilRiseRatedK ?? 55;
  const gRated = p.hotspotGradientK ?? 23;
  const n = p.oilExponent ?? 0.8;
  const m = p.windingExponent ?? 0.8;
  const H = p.hotspotFactor ?? 1.1;

  const K = Math.max(0, p.loadKva) / rating;
  const R = Pk / Math.max(1, P0);

  // Steady-state top-oil rise.
  const topOilRiseK = dOilRated * Math.pow((1 + R * K * K) / (1 + R), n);
  const topOilC = p.ambientC + topOilRiseK;

  // Hot-spot sits above the top oil by the winding gradient.
  const hotspotRiseK = H * gRated * Math.pow(K, 2 * m);
  const hotspotC = topOilC + hotspotRiseK;

  // Relative ageing. Doubles roughly every 6 K above 98 °C.
  const ageingRate = Math.pow(2, (hotspotC - REFERENCE_HOTSPOT_C) / 6);

  const loadLossW = Pk * K * K;
  const totalLossesW = P0 + loadLossW;

  const pf = p.powerFactor ?? 0.95;
  const outputW = p.loadKva * 1000 * pf;
  const efficiencyPct = outputW > 0 ? (outputW / (outputW + totalLossesW)) * 100 : 0;

  const findings: string[] = [];
  let band: ThermalBand = "NORMAL";

  if (K > 1.0) {
    band = "OVERLOAD";
    findings.push(`Loaded to ${(K * 100).toFixed(1)} % of nameplate — above continuous rating.`);
  } else if (K > 0.95) {
    band = "WATCH";
    findings.push(`Loaded to ${(K * 100).toFixed(1)} % — approaching the continuous limit.`);
  }

  if (hotspotC > LIMIT_HOTSPOT_C) {
    band = "CRITICAL";
    findings.push(`Hot-spot ${hotspotC.toFixed(0)} °C exceeds the ${LIMIT_HOTSPOT_C} °C limit for normal cyclic loading.`);
  } else if (hotspotC > 110) {
    if (band !== "OVERLOAD") band = "WATCH";
    findings.push(`Hot-spot ${hotspotC.toFixed(0)} °C is within limits but elevated.`);
  }

  if (topOilC > LIMIT_TOP_OIL_C) {
    band = "CRITICAL";
    findings.push(`Top-oil ${topOilC.toFixed(0)} °C exceeds the ${LIMIT_TOP_OIL_C} °C limit.`);
  }

  if (ageingRate > 2) {
    findings.push(`Insulation ageing ${ageingRate.toFixed(1)}× normal — one hour here costs ${ageingRate.toFixed(1)} hours of life.`);
  }

  if (K > LIMIT_CURRENT_PU) {
    band = "CRITICAL";
    findings.push(`Current ${K.toFixed(2)} pu exceeds the ${LIMIT_CURRENT_PU} pu emergency ceiling.`);
  }

  if (findings.length === 0) {
    findings.push(`Operating normally. Hot-spot ${hotspotC.toFixed(0)} °C, ageing at ${ageingRate.toFixed(2)}× normal.`);
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
  };
}

/** A 0–100 condition score a manager can rank by. */
export function conditionScore(t: ThermalResult, avgVoltage: number, minVoltage: number, powerFactor: number): number {
  let score = 100;
  if (t.loadingPct > 100) score -= Math.min(35, (t.loadingPct - 100) * 1.8);
  else if (t.loadingPct > 80) score -= (t.loadingPct - 80) * 0.4;

  if (t.hotspotC > REFERENCE_HOTSPOT_C) score -= Math.min(30, (t.hotspotC - REFERENCE_HOTSPOT_C) * 1.4);
  // Kenyan LV nominal is 240 V single phase; ±6 % is the statutory band.
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
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
