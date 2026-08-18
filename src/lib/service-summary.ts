import "server-only";
import { prisma } from "./prisma";
import { computeThermal } from "./transformer-thermal";
import { ambientForMonth, priceLossOfLife } from "./load-balancing";
import { estimateNewUnitCostKes } from "./repair-economics";

/**
 * The Service Summary card — everything about a transformer's working life,
 * calculated from the event chain and its measurements rather than stored
 * anywhere. A cached "days in service" goes stale the day after it is written;
 * derived from the actual dates, it cannot.
 */

const DAY = 86_400_000;

export type ServiceSummary = {
  age: { years: number; months: number; days: number };
  ageSource: "installation" | "manufacture year";
  daysInService: number | null;
  daysInRepair: number;
  daysAwaitingAction: number;
  totalEvents: number;
  inspectionsCompleted: number;
  testsPerformed: number;
  faultsReported: number;
  repairsCompleted: number;
  warrantyClaimsFiled: number;
  purchaseCostKes: number;
  repairCostKes: number;
  /** Null when no EMDis load data exists yet — never fabricated. */
  lossOfLifeCostKesPerHour: number | null;
};

/** Calendar year/month/day breakdown between two dates — not just total days. */
function ageBreakdown(from: Date, to: Date): { years: number; months: number; days: number } {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  let days = to.getDate() - from.getDate();
  if (days < 0) {
    months -= 1;
    const daysInPrevMonth = new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    days += daysInPrevMonth;
  }
  if (months < 0) { years -= 1; months += 12; }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

export async function computeServiceSummary(input: {
  transformer: {
    id: string;
    ratingKva: number;
    secondaryKv: number | null;
    yearOfManufacture: number;
    commissionDate: Date | null;
  };
  events: { type: string; toStatus: string; occurredAt: Date }[];
  repairs: { receivedAtWorkshop: Date; repairCompletedAt: Date | null; repairCostKes: number | null }[];
  testsCount: number;
  claimsCount: number;
}): Promise<ServiceSummary> {
  const { transformer: tx, events, repairs, testsCount, claimsCount } = input;
  const now = new Date();

  const installedEvent = [...events].reverse().find((e) => e.type === "INSTALLED");
  const installDate = tx.commissionDate ?? installedEvent?.occurredAt ?? null;
  const ageFrom = installDate ?? new Date(tx.yearOfManufacture, 0, 1);
  const age = ageBreakdown(ageFrom, now);
  const ageSource: ServiceSummary["ageSource"] = installDate ? "installation" : "manufacture year";

  const daysInService = installDate ? Math.floor((now.getTime() - installDate.getTime()) / DAY) : null;

  // --- Days in repair — sum of every workshop visit's span, open ones count to now.
  const daysInRepair = repairs.reduce((sum, r) => {
    const end = r.repairCompletedAt ?? now;
    return sum + Math.max(0, (end.getTime() - r.receivedAtWorkshop.getTime()) / DAY);
  }, 0);

  // --- Days awaiting action — sum of every span the chain shows the unit
  // sitting in AWAITING_REPLACEMENT, closed by whichever event came next.
  const chronological = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let daysAwaitingAction = 0;
  for (let i = 0; i < chronological.length; i++) {
    if (chronological[i].toStatus !== "AWAITING_REPLACEMENT") continue;
    const start = chronological[i].occurredAt;
    const end = chronological[i + 1]?.occurredAt ?? now;
    daysAwaitingAction += Math.max(0, (end.getTime() - start.getTime()) / DAY);
  }

  const inspectionsCompleted = events.filter((e) => e.type === "INSPECTED").length;
  const faultsReported = events.filter((e) => e.type === "FAULT_REPORTED").length;
  const repairsCompleted = repairs.filter((r) => r.repairCompletedAt != null).length;

  const purchaseCostKes = estimateNewUnitCostKes(tx.ratingKva);
  const repairCostKes = repairs.reduce((s, r) => s + (r.repairCostKes ?? 0), 0);

  const latestHour = await prisma.emdisHourly.findFirst({
    where: { transformerId: tx.id },
    orderBy: { hourStart: "desc" },
    select: { maxPhasePctRated: true, hourStart: true },
  });

  let lossOfLifeCostKesPerHour: number | null = null;
  if (latestHour?.maxPhasePctRated != null) {
    const ambientC = ambientForMonth(latestHour.hourStart.getUTCMonth());
    const loadKva = (latestHour.maxPhasePctRated / 100) * tx.ratingKva;
    const thermal = computeThermal({ loadKva, ratingKva: tx.ratingKva, ambientC, powerFactor: 0.95 });
    const money = priceLossOfLife(thermal.ageingRate, purchaseCostKes, 1);
    lossOfLifeCostKesPerHour = money.currentPerHourKes;
  }

  return {
    age, ageSource, daysInService, daysInRepair: Math.round(daysInRepair),
    daysAwaitingAction: Math.round(daysAwaitingAction),
    totalEvents: events.length,
    inspectionsCompleted, testsPerformed: testsCount, faultsReported, repairsCompleted,
    warrantyClaimsFiled: claimsCount,
    purchaseCostKes, repairCostKes,
    lossOfLifeCostKesPerHour,
  };
}
