/**
 * Health scoring.
 *
 * A 0–100 number a manager can sort by, DERIVED from the latest test and the
 * failure history — never stored. Stored health goes stale the moment a new
 * test lands and nobody recomputes it; a derived score cannot lie.
 *
 * Thresholds follow common utility practice for oil-immersed distribution
 * transformers (IEC 60076 for ratio, IEC 60422 for oil, IEEE C57 for
 * insulation). CONFIRM against KPLC's own testing standard before the demo.
 */

export const OIL_BDV_MIN_KV = 30;
export const IR_MIN_MOHM = 100;
export const RATIO_MAX_DEVIATION_PCT = 0.5;

export type TestLike = {
  passed: boolean;
  oilBdvKv?: number | null;
  insulationResistanceHvMohm?: number | null;
  insulationResistanceLvMohm?: number | null;
  turnsRatioDeviationPct?: number | null;
};

export type HealthInput = {
  latestTest?: TestLike | null;
  failureCount: number;
  ageYears: number;
};

export type HealthBand = "GOOD" | "WATCH" | "AT_RISK" | "CRITICAL";

export type HealthResult = {
  score: number;
  band: HealthBand;
  reasons: string[];
};

export function computeHealth(input: HealthInput): HealthResult {
  let score = 100;
  const reasons: string[] = [];

  const test = input.latestTest;
  if (test) {
    if (!test.passed) {
      score -= 30;
      reasons.push("Most recent test was a fail.");
    }
    if (test.oilBdvKv != null && test.oilBdvKv < OIL_BDV_MIN_KV) {
      score -= 15;
      reasons.push(`Oil BDV ${test.oilBdvKv} kV is below the ${OIL_BDV_MIN_KV} kV minimum.`);
    }
    if (
      test.insulationResistanceHvMohm != null &&
      test.insulationResistanceHvMohm < IR_MIN_MOHM
    ) {
      score -= 15;
      reasons.push(
        `HV insulation ${test.insulationResistanceHvMohm} MΩ is below the ${IR_MIN_MOHM} MΩ minimum.`,
      );
    }
    if (
      test.turnsRatioDeviationPct != null &&
      Math.abs(test.turnsRatioDeviationPct) > RATIO_MAX_DEVIATION_PCT
    ) {
      score -= 10;
      reasons.push(
        `Turns ratio deviates ${test.turnsRatioDeviationPct}%, over the ${RATIO_MAX_DEVIATION_PCT}% limit.`,
      );
    }
  } else {
    score -= 5;
    reasons.push("No test results recorded yet.");
  }

  if (input.failureCount > 0) {
    score -= Math.min(30, input.failureCount * 15);
    reasons.push(
      `${input.failureCount} failure${input.failureCount > 1 ? "s" : ""} in service.`,
    );
  }

  // Distribution transformers are designed for roughly 30 years of service.
  if (input.ageYears > 20) {
    score -= Math.min(15, Math.floor((input.ageYears - 20) * 1.5));
    reasons.push(`${Math.floor(input.ageYears)} years in service.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, band: bandFor(score), reasons };
}

export function bandFor(score: number): HealthBand {
  if (score >= 80) return "GOOD";
  if (score >= 60) return "WATCH";
  if (score >= 40) return "AT_RISK";
  return "CRITICAL";
}

export const HEALTH_BAND_META: Record<
  HealthBand,
  { label: string; tone: "success" | "info" | "warning" | "danger" }
> = {
  GOOD: { label: "Good", tone: "success" },
  WATCH: { label: "Watch", tone: "info" },
  AT_RISK: { label: "At risk", tone: "warning" },
  CRITICAL: { label: "Critical", tone: "danger" },
};
