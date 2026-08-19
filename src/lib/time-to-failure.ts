/**
 * Time to failure, derived from the ageing rate and nothing else.
 *
 * There was one bug here worth naming: the number was rounded to a single
 * decimal place. At an ageing rate of 105.61x the answer is 0.284 years, and
 * round1() reports that as 0.3 - so the printed figure disagreed with the
 * ageing rate it came from, and no manual check could ever reproduce it.
 *
 * Insulation life is consumed at the ageing rate. A unit running at 105x is
 * spending a hundred years of thermal life every calendar year, so:
 *
 *   TTF = normal_life_years / ageing_rate
 *
 * This is an APPROXIMATION and is labelled as one everywhere it surfaces. It
 * assumes the load pattern in front of us continues, and it models thermal
 * ageing of the paper only - not a bushing flashover, not a lightning strike,
 * not water ingress, not the tap changer. A transformer at 0.28 years does not
 * fail in exactly 102 days. What the number IS good for is ranking: it tells a
 * planner which unit is being destroyed fastest, and by how many times.
 */

/**
 * IEC 60076-7 design basis: normal insulation life at a 98 degC hot-spot.
 * This is the figure the rest of the system has always used, so it stays the
 * default - changing it would move every number on every report at once.
 */
export const NORMAL_LIFE_YEARS = 30;

/**
 * IEEE C57.91 basis: 180,000 hours = 20.55 years. Provided because a manual
 * check done against IEEE will land on 20.55 / rate, not 30 / rate, and the
 * two answers differ by 1.46x. Anyone comparing by hand must know which basis
 * produced the printed number, which is why lifeFromAgeing() returns it.
 */
export const IEEE_NORMAL_LIFE_YEARS = 20.55;

/** Below this the arithmetic is meaningless, not merely optimistic. */
const MIN_RATE = 0.001;

export type LifeFromAgeing = {
  /** The ageing rate this was derived from. Same number the report prints. */
  ageingRate: number;
  /** The life basis used. On the report, so the reader can reproduce it. */
  normalLifeYears: number;
  yearsToEndOfLife: number;
  daysToEndOfLife: number;
  /** The division, spelled out, for a manual-versus-system comparison. */
  arithmetic: string;
  /** Plain-language caveat. Print it next to the number, not in a footnote. */
  caveat: string;
};

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The single TTF formula. Every caller uses this one - the MCP tools, the
 * prognosis panel, the dossier PDF - so the figure cannot drift between them.
 */
export function timeToFailureYears(
  ageingRate: number,
  normalLifeYears: number = NORMAL_LIFE_YEARS,
): number {
  const rate = Number.isFinite(ageingRate) ? Math.max(MIN_RATE, ageingRate) : MIN_RATE;
  return normalLifeYears / rate;
}

export function lifeFromAgeing(
  ageingRate: number,
  normalLifeYears: number = NORMAL_LIFE_YEARS,
): LifeFromAgeing {
  const rate = Number.isFinite(ageingRate) ? Math.max(MIN_RATE, ageingRate) : MIN_RATE;
  const years = normalLifeYears / rate;
  return {
    ageingRate: rate,
    normalLifeYears,
    yearsToEndOfLife: years,
    daysToEndOfLife: years * 365.25,
    arithmetic:
      normalLifeYears.toFixed(2) + ' y / ' + rate.toFixed(2) + 'x = ' +
      round3(years).toFixed(3) + ' y (' + Math.round(years * 365.25) + ' days)',
    caveat:
      'Thermal ageing of the insulation only, at the load pattern measured. ' +
      'An approximation for ranking urgency, not a failure date.',
  };
}
