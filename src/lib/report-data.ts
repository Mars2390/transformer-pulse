import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { verifyChain, type ChainLink } from "./chain";
import { computeWarranty } from "./warranty";
import { computeHealth, HEALTH_BAND_META } from "./health";
import type { CellTone } from "./reports";

/** Shared formatting + calculated fields for every export. */

const DAY = 86_400_000;
export const INSPECTION_DUE_SOON = 150;
export const INSPECTION_OVERDUE = 180;

/** DD/MM/YYYY — the format every date in every export uses. */
export function dmy(date: Date | null | undefined): string {
  if (!date) return "";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function daysSince(date: Date | null | undefined): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / DAY);
}

export function gps(v: number | null | undefined): string {
  return v == null ? "" : v.toFixed(6);
}

/** Last up to 3 values of a test field, oldest→newest: "62 → 48 → 31". */
export function trend(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v != null).slice(0, 3).reverse();
  return nums.length ? nums.join(" → ") : "";
}

export const STATUS_TONE: Record<string, CellTone> = {
  IN_FIELD: "field",
  FAULTY: "faulty",
  IN_STORE: "store",
  IN_TRANSIT: "transit",
  RETURNED: "returned",
  SCRAPPED: "scrapped",
};

export function inspectionStatus(days: number | null): { label: string; tone: CellTone } {
  if (days == null) return { label: "Never inspected", tone: "overdue" };
  if (days > INSPECTION_OVERDUE) return { label: "OVERDUE", tone: "overdue" };
  if (days >= INSPECTION_DUE_SOON) return { label: "Due Soon", tone: "due" };
  return { label: "OK", tone: "ok" };
}

export function warrantyStatus(days: number | null): { label: string; tone: CellTone } {
  if (days == null) return { label: "Not started", tone: "returned" };
  if (days <= 0) return { label: "Expired", tone: "expired" };
  if (days < 30) return { label: "CRITICAL", tone: "critical" };
  if (days <= 90) return { label: "Expiring Soon", tone: "expiring" };
  return { label: "Covered", tone: "covered" };
}

/** Rich include used by the master exports. */
const richInclude = {
  manufacturer: { select: { name: true } },
  currentStore: { select: { name: true } },
  tests: {
    orderBy: { testedAt: "desc" as const },
    include: { testedBy: { select: { name: true } } },
  },
  events: {
    orderBy: { occurredAt: "asc" as const },
    include: { user: { select: { name: true } } },
  },
} satisfies Prisma.TransformerInclude;

export type EnrichedTransformer = ReturnType<typeof enrichOne>;

function enrichOne(
  tx: Prisma.TransformerGetPayload<{ include: typeof richInclude }>,
) {
  const events = tx.events;
  const chain = verifyChain(events as unknown as ChainLink[]);

  const installedEvent = events.find((e) => e.type === "INSTALLED");
  const dispatchedEvent = [...events].reverse().find((e) => e.type === "DISPATCHED");
  const inspects = events.filter((e) => e.type === "INSPECTED" || e.type === "INSTALLED");
  const lastInspect = inspects[inspects.length - 1];
  const faults = events.filter((e) => e.type === "FAULT_REPORTED");
  const lastFault = faults[faults.length - 1];
  const faults12mo = faults.filter((e) => Date.now() - e.occurredAt.getTime() <= 365 * DAY).length;

  const installDate = installedEvent?.occurredAt ?? tx.commissionDate ?? null;
  const lastInspectionDate = lastInspect?.occurredAt ?? null;
  const inspDays = daysSince(lastInspectionDate);

  const w = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
  const health = computeHealth({
    latestTest: tx.tests[0] ?? null,
    failureCount: faults.length,
    ageYears: new Date().getFullYear() - tx.yearOfManufacture,
  });

  return {
    tx,
    events,
    chainValid: chain.valid,
    // dates
    installDate,
    daysSinceInstall: daysSince(installDate),
    lastInspectionDate,
    daysSinceInspection: inspDays,
    inspection: inspectionStatus(inspDays),
    // tests + trends
    lastOilBdv: tx.tests.find((t) => t.oilBdvKv != null)?.oilBdvKv ?? null,
    oilBdvTrend: trend(tx.tests.map((t) => t.oilBdvKv)),
    lastIrHv: tx.tests.find((t) => t.insulationResistanceHvMohm != null)?.insulationResistanceHvMohm ?? null,
    irHvTrend: trend(tx.tests.map((t) => t.insulationResistanceHvMohm)),
    lastIrLv: tx.tests.find((t) => t.insulationResistanceLvMohm != null)?.insulationResistanceLvMohm ?? null,
    irLvTrend: trend(tx.tests.map((t) => t.insulationResistanceLvMohm)),
    // faults
    faults12mo,
    lastFaultDate: lastFault?.occurredAt ?? null,
    lastFaultCause: lastFault?.notes ?? "",
    // warranty
    warrantyExpiry: w.expiresAt,
    warrantyDaysLeft: w.daysRemaining,
    warranty: warrantyStatus(w.daysRemaining),
    // health
    healthLabel: HEALTH_BAND_META[health.band].label,
    healthTone: (health.band === "GOOD" ? "good" : health.band === "CRITICAL" || health.band === "AT_RISK" ? "critical" : "warning") as CellTone,
    // people
    dispatchedBy: dispatchedEvent?.user.name ?? "",
    installedBy: installedEvent?.user.name ?? "",
    lastInspectedBy: lastInspect?.user.name ?? "",
  };
}

export async function loadEnriched(
  where: Prisma.TransformerWhereInput,
): Promise<{ rows: EnrichedTransformer[]; verified: number; total: number }> {
  const transformers = await prisma.transformer.findMany({
    where,
    orderBy: [{ status: "asc" }, { gNumber: "asc" }],
    include: richInclude,
  });

  const rows = transformers.map(enrichOne);
  const verified = rows.filter((r) => r.chainValid).length;
  return { rows, verified, total: rows.length };
}

/** Region scope for a given user role. Admin sees all. */
export function reportScope(role: string, region: string | null): Prisma.TransformerWhereInput {
  return role === "ADMIN" ? {} : region ? { region } : {};
}
