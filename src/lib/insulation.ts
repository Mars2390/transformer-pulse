/**
 * Insulation and winding resistance — the physics, with no database in sight.
 *
 * Deliberately separate from combined-health.ts, which is server-only because
 * it queries. These are pure functions over numbers, so they can be checked
 * against a textbook without standing up an application. A formula that can
 * only be tested by booting a server is a formula nobody tests.
 */

/** Thresholds for judging an insulation or winding test. */
export const IR_LIMITS = {
  /**
   * Below this the unit should not be energised. KPLC's own floor, and the one
   * George stated plainly: under 1 MΩ, flag it.
   */
  hardFloorMohm: 1,
  criticalMohm: 50,
  warnMohm: 100,

  /**
   * Polarization index — IR at 10 minutes divided by IR at 1 minute. Below 1.0
   * the insulation is absorbing moisture, which a single healthy-looking
   * megohm figure hides completely.
   */
  piCritical: 1.0,
  piWarn: 2.0,

  /** Winding resistance is judged by the spread between phases. */
  wrDeviationWarnPct: 2,
  wrDeviationCriticalPct: 5,
} as const;

/** KPLC practice for a distribution earth electrode. */
export const EARTH_LIMIT_OHM = 10;
export const EARTH_CRITICAL_OHM = 50;

/**
 * Insulation resistance corrected to 20 °C.
 *
 *   R20 = Rt × 2^((t − 20) / 10)
 *
 * IR roughly halves for every 10 °C rise. A reading at 45 °C and one at 25 °C
 * differ by about four times on the same healthy winding, so an uncorrected
 * trend is not a trend — it is a record of the weather. This is why winding
 * temperature is mandatory wherever IR is captured.
 */
export function correctIrTo20C(readingMohm: number, windingTempC: number): number {
  return readingMohm * Math.pow(2, (windingTempC - 20) / 10);
}

/**
 * Spread between phase resistances, as a percentage of their mean.
 *
 * The absolute value of winding resistance depends on the design and means
 * little without the factory test certificate. The SPREAD between three phases
 * of the same winding is self-referencing: they should match, and when they do
 * not the difference points at a loose connection or a damaged turn.
 *
 * Returns null with fewer than two readings — one phase cannot disagree.
 */
export function wrDeviationPct(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null && x > 0);
  if (v.length < 2) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  if (mean <= 0) return null;
  return (Math.max(...v.map((x) => Math.abs(x - mean))) / mean) * 100;
}

/** Health bands, shared by every score in the system. */
export const bandOf = (s: number | null): "GREEN" | "AMBER" | "RED" | "UNKNOWN" =>
  s == null ? "UNKNOWN" : s >= 70 ? "GREEN" : s >= 40 ? "AMBER" : "RED";
