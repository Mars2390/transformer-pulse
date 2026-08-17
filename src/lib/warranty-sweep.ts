import "server-only";
import { prisma } from "@/lib/prisma";
import { computeWarranty, type WarrantyState } from "@/lib/warranty";
import type { TransformerStatus } from "@/generated/prisma/enums";

/**
 * Statuses where a warranty is no longer worth watching.
 *
 * Deliberately an EXCLUDE list, not an include list. The first version of this
 * enumerated the live statuses and quietly dropped REPAIRED — a unit that has
 * come back from a workshop and is waiting to return to store, still owned by
 * KPLC and still inside the manufacturer's term. Its cover lapsed silently.
 *
 * Excluding terminal states instead means a status added later is watched by
 * default. For a warranty watchlist that is the safe direction to be wrong in:
 * an alert nobody needed costs a glance, and cover that lapses unnoticed costs
 * the price of a transformer.
 */
const TERMINAL: TransformerStatus[] = ["SCRAPPED", "BEYOND_REPAIR", "RETURNED"];

/**
 * Warranty expiry, watched rather than looked up.
 *
 * ---------------------------------------------------------------------------
 * KPLC POLICY: the warranty clock starts at DELIVERY
 * ---------------------------------------------------------------------------
 * The brief asked for a decision between starting the clock at APPROVAL (when a
 * unit becomes stock) and at INSTALLATION (when it is energised). Neither. It
 * starts when KPLC takes delivery, which is what this system already records as
 * `warrantyStart` at receipt, and the reasoning is worth stating because both
 * alternatives are actively worse:
 *
 *   INSTALLATION is wrong because it hands KPLC cover it never bought. A unit
 *   that sits in a store for eight months would arrive on a pole with a full
 *   term still to run, meaning the manufacturer is on the hook for eight months
 *   longer than the contract says. No manufacturer honours that, so every claim
 *   near the end of the term becomes an argument KPLC loses — and loses AFTER
 *   spending money on the claim file.
 *
 *   APPROVAL is wrong for the opposite reason. Approval is an internal
 *   administrative timestamp; it can lag delivery by days or weeks because
 *   somebody was on leave. Basing a contractual clock on our own paperwork
 *   speed means the supplier's liability moves with our staffing, which is
 *   unarguable in the wrong direction the first time it is challenged.
 *
 * Delivery is the date on the delivery note. It is the date both parties
 * already agree on, it is on paper, and it is the one the contract names.
 *
 * The cost of this choice, stated honestly: shelf time burns warranty. A unit
 * held eighteen months in a store can reach a pole with its cover already gone.
 * That is a real loss — but it is a loss KPLC is ALREADY taking today and
 * cannot see. Making the clock honest is what turns it into a visible stock
 * rotation problem instead of an invisible one, which is what the 90-day
 * warning below exists to surface.
 *
 * ---------------------------------------------------------------------------
 * Why a sweep and not a computed column
 * ---------------------------------------------------------------------------
 * Expiry is derived from warrantyStart + warrantyMonths, so it is computed, not
 * stored — a stored warrantyEndsAt would be a second copy that drifts the first
 * time somebody edits warrantyMonths through a path that forgets to recompute
 * it. What a sweep adds is the thing a computed value cannot do: notice.
 * Nobody opens a transformer's page on the day its cover lapses.
 */

/** Cover ends within this many days: worth telling somebody. */
export const WARN_DAYS = 90;
/** Cover ends within this many days: act now or lose the claim. */
export const CRITICAL_DAYS = 30;

export type SweepResult = {
  scanned: number;
  warned: number;
  critical: number;
  expired: number;
  /** Alerts suppressed because an equivalent unacknowledged one already exists. */
  alreadyOpen: number;
};

type Band = "WARN" | "CRITICAL" | "EXPIRED" | null;

function bandFor(state: WarrantyState, daysRemaining: number | null): Band {
  if (state === "EXPIRED") return "EXPIRED";
  if (daysRemaining == null) return null;
  if (daysRemaining <= CRITICAL_DAYS) return "CRITICAL";
  if (daysRemaining <= WARN_DAYS) return "WARN";
  return null;
}

/**
 * Raise warranty alerts for everything approaching or past expiry.
 *
 * Safe to run repeatedly — hourly, nightly, or by hand from the manager's
 * dashboard. A transformer gets at most one unacknowledged WARRANTY_EXPIRING
 * alert per severity, so running this every hour does not bury the alert list
 * under the same warning three hundred times. When a unit crosses from the
 * 90-day band into the 30-day band it correctly gets a second, louder alert:
 * that is a genuine escalation, not a repeat.
 */
export async function sweepWarranties(opts?: { region?: string | null }): Promise<SweepResult> {
  const units = await prisma.transformer.findMany({
    where: {
      ...(opts?.region ? { region: { contains: opts.region, mode: "insensitive" as const } } : {}),
      warrantyStart: { not: null },
      // Everything KPLC still owns and could still claim on.
      status: { notIn: TERMINAL },
    },
    select: {
      id: true,
      gNumber: true,
      serialNumber: true,
      ratingKva: true,
      region: true,
      status: true,
      warrantyStart: true,
      warrantyMonths: true,
      currentSiteName: true,
      manufacturer: { select: { name: true } },
    },
  });

  const result: SweepResult = { scanned: units.length, warned: 0, critical: 0, expired: 0, alreadyOpen: 0 };
  if (units.length === 0) return result;

  // One query for every open warranty alert, rather than one per transformer.
  const existing = await prisma.alert.findMany({
    where: {
      type: "WARRANTY_EXPIRING",
      acknowledged: false,
      transformerId: { in: units.map((u) => u.id) },
    },
    select: { transformerId: true, severity: true },
  });
  const openBySeverity = new Set(existing.map((a) => `${a.transformerId}:${a.severity}`));

  const toCreate: {
    transformerId: string;
    type: "WARRANTY_EXPIRING";
    severity: "WARNING" | "CRITICAL";
    region: string | null;
    message: string;
  }[] = [];

  for (const u of units) {
    const info = computeWarranty(u.warrantyStart, u.warrantyMonths);
    const band = bandFor(info.state, info.daysRemaining);
    if (!band) continue;

    const label = u.gNumber ?? u.serialNumber;
    const where = u.currentSiteName ?? u.region ?? "location not recorded";
    const severity = band === "WARN" ? "WARNING" : "CRITICAL";

    if (band === "WARN") result.warned++;
    else if (band === "CRITICAL") result.critical++;
    else result.expired++;

    if (openBySeverity.has(`${u.id}:${severity}`)) {
      result.alreadyOpen++;
      continue;
    }

    const message =
      band === "EXPIRED"
        ? `${label} (${u.ratingKva} kVA, ${u.manufacturer.name}) is out of warranty as of ${info.expiresAt?.toISOString().slice(0, 10)}. At ${where}. Any failure from here is KPLC's cost.`
        : `${label} (${u.ratingKva} kVA, ${u.manufacturer.name}) has ${info.daysRemaining} days of ${u.manufacturer.name} warranty left, expiring ${info.expiresAt?.toISOString().slice(0, 10)}. At ${where}. Inspect it while a failure is still the manufacturer's cost.`;

    toCreate.push({
      transformerId: u.id,
      type: "WARRANTY_EXPIRING",
      severity,
      region: u.region,
      message,
    });
    openBySeverity.add(`${u.id}:${severity}`);
  }

  if (toCreate.length) await prisma.alert.createMany({ data: toCreate });

  return result;
}

export type ExpiringSummary = {
  within30: number;
  within90: number;
  expired: number;
  /** Money at risk: replacement value of everything lapsing within 30 days. */
  atRiskKes: number;
};

/**
 * The dashboard tile's numbers, without raising anything.
 *
 * Separate from the sweep on purpose: rendering a page must never have a side
 * effect on the alert list, or a manager refreshing their dashboard becomes the
 * thing that generates their own notifications.
 */
export async function summariseExpiring(where: Record<string, unknown> = {}): Promise<ExpiringSummary> {
  const { estimateReplacementValueKes } = await import("@/lib/warranty");

  const units = await prisma.transformer.findMany({
    where: {
      ...where,
      warrantyStart: { not: null },
      status: { notIn: TERMINAL },
    },
    select: { ratingKva: true, warrantyStart: true, warrantyMonths: true },
  });

  const summary: ExpiringSummary = { within30: 0, within90: 0, expired: 0, atRiskKes: 0 };

  for (const u of units) {
    const info = computeWarranty(u.warrantyStart, u.warrantyMonths);
    if (info.state === "EXPIRED") {
      summary.expired++;
      continue;
    }
    if (info.daysRemaining == null) continue;
    if (info.daysRemaining <= WARN_DAYS) summary.within90++;
    if (info.daysRemaining <= CRITICAL_DAYS) {
      summary.within30++;
      summary.atRiskKes += estimateReplacementValueKes(u.ratingKva);
    }
  }

  return summary;
}
