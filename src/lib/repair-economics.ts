/**
 * Repair-versus-replace arithmetic, with no database in sight.
 *
 * Split from repair.ts for the same reason the insulation formulas were split
 * from the scoring: repair.ts is server-only because it writes, and a number
 * that can only be checked by booting an application is a number nobody checks.
 */

/**
 * The economic line. Above this fraction of a new unit, rewinding is usually
 * throwing money at an asset that will come back.
 *
 * Sixty per cent is the common utility rule of thumb rather than a standard,
 * and it is a PROMPT, not a veto — sometimes there is nothing else to give the
 * site, and a 70% repair that restores supply this week beats a replacement
 * that arrives next quarter. The system shows the number; a human decides.
 */
export const REPAIR_ECONOMIC_LIMIT = 0.6;

/** After this many trips to a workshop, the unit itself is the problem. */
export const REPEAT_REPAIR_LIMIT = 3;

/**
 * Indicative replacement cost by rating, in KES.
 *
 * These are order-of-magnitude figures for Kenyan distribution transformers,
 * NOT quotations, and every screen that shows them says so. The moment KPLC
 * supplies a real price list this should read from it — the point is to give
 * the repair-or-replace comparison a denominator, not to price a purchase.
 */
const PRICE_TABLE: [number, number][] = [
  [50, 450_000],
  [100, 700_000],
  [200, 1_100_000],
  [315, 1_500_000],
  [500, 2_200_000],
  [630, 2_800_000],
  [1000, 4_200_000],
];

export function estimateNewUnitCostKes(ratingKva: number): number {
  const exact = PRICE_TABLE.find(([kva]) => kva === ratingKva);
  if (exact) return exact[1];

  // Between listed sizes, interpolate on the nearest pair rather than guessing.
  const below = [...PRICE_TABLE].reverse().find(([kva]) => kva < ratingKva);
  const above = PRICE_TABLE.find(([kva]) => kva > ratingKva);
  if (below && above) {
    const t = (ratingKva - below[0]) / (above[0] - below[0]);
    return Math.round(below[1] + t * (above[1] - below[1]));
  }
  // Outside the table entirely — a rough per-kVA rate, clearly approximate.
  return Math.round(ratingKva * 4_500);
}

export type RepairEconomics = {
  repairCostKes: number;
  newUnitEstimateKes: number;
  ratio: number;
  uneconomic: boolean;
  message: string;
};

export function assessRepairCost(repairCostKes: number, ratingKva: number): RepairEconomics {
  const newUnitEstimateKes = estimateNewUnitCostKes(ratingKva);
  const ratio = repairCostKes / newUnitEstimateKes;
  const uneconomic = ratio > REPAIR_ECONOMIC_LIMIT;

  return {
    repairCostKes,
    newUnitEstimateKes,
    ratio,
    uneconomic,
    message: uneconomic
      ? `KES ${Math.round(repairCostKes).toLocaleString()} is ${Math.round(ratio * 100)}% of a new ` +
        `${ratingKva} kVA unit (about KES ${newUnitEstimateKes.toLocaleString()}). Above ` +
        `${REPAIR_ECONOMIC_LIMIT * 100}% a replacement is usually the better buy — though not if the ` +
        `site is off supply and nothing else is free.`
      : `KES ${Math.round(repairCostKes).toLocaleString()} is ${Math.round(ratio * 100)}% of a new ` +
        `${ratingKva} kVA unit. Economic.`,
  };
}
