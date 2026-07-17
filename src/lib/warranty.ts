/**
 * Warranty maths.
 *
 * The clock starts when KPLC takes delivery at the store, not at the date of
 * manufacture. A transformer that sat in a container for eight months has not
 * burned eight months of cover — and the paper process gets this wrong, always
 * in the manufacturer's favour.
 */

export type WarrantyState =
  | "NOT_STARTED"
  | "UNDER_WARRANTY"
  | "EXPIRING_SOON"
  | "EXPIRED";

export const EXPIRING_SOON_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export type WarrantyInfo = {
  state: WarrantyState;
  expiresAt: Date | null;
  daysRemaining: number | null;
  monthsRemaining: number | null;
  /** True when a failure right now is the manufacturer's problem, not ours. */
  claimable: boolean;
};

export function computeWarranty(
  warrantyStart: Date | null | undefined,
  warrantyMonths: number,
  asOf: Date = new Date(),
): WarrantyInfo {
  if (!warrantyStart) {
    return {
      state: "NOT_STARTED",
      expiresAt: null,
      daysRemaining: null,
      monthsRemaining: null,
      claimable: false,
    };
  }

  const expiresAt = new Date(warrantyStart);
  expiresAt.setMonth(expiresAt.getMonth() + warrantyMonths);

  const daysRemaining = Math.ceil(
    (expiresAt.getTime() - asOf.getTime()) / MS_PER_DAY,
  );
  const monthsRemaining = Math.floor(daysRemaining / 30.44);

  if (daysRemaining <= 0) {
    return {
      state: "EXPIRED",
      expiresAt,
      daysRemaining,
      monthsRemaining: 0,
      claimable: false,
    };
  }

  return {
    state: daysRemaining <= EXPIRING_SOON_DAYS ? "EXPIRING_SOON" : "UNDER_WARRANTY",
    expiresAt,
    daysRemaining,
    monthsRemaining,
    claimable: true,
  };
}

/** Short human summary for a table cell. */
export function warrantyLabel(info: WarrantyInfo): string {
  switch (info.state) {
    case "NOT_STARTED":
      return "Not started";
    case "EXPIRED":
      return "Expired";
    case "EXPIRING_SOON":
      return `${info.daysRemaining} days left`;
    case "UNDER_WARRANTY":
      return info.monthsRemaining && info.monthsRemaining >= 1
        ? `${info.monthsRemaining} months left`
        : `${info.daysRemaining} days left`;
  }
}

/**
 * Indicative replacement value in KES, by rating.
 *
 * These are PLANNING ESTIMATES used for the recoverable-value figure on the
 * manager's dashboard. Procurement's actual contract prices should replace them
 * before any number here is used to negotiate with a manufacturer.
 */
const REPLACEMENT_VALUE_KES: Record<number, number> = {
  25: 420_000,
  50: 610_000,
  100: 920_000,
  200: 1_450_000,
  315: 2_050_000,
  500: 2_850_000,
  1000: 4_600_000,
};

export function estimateReplacementValueKes(ratingKva: number): number {
  const exact = REPLACEMENT_VALUE_KES[ratingKva];
  if (exact) return exact;

  const ratings = Object.keys(REPLACEMENT_VALUE_KES).map(Number).sort((a, b) => a - b);
  const below = [...ratings].reverse().find((r) => r < ratingKva) ?? ratings[0];
  return Math.round((REPLACEMENT_VALUE_KES[below] * (ratingKva / below)) / 10_000) * 10_000;
}
