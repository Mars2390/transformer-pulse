import "./server-guard";
import { prisma } from "./prisma";

/**
 * Manufacturer reliability, computed from what actually happened to their
 * units in the field — not from a supplier's own data sheet.
 *
 * Everything here is a bulk query followed by in-memory grouping, the same
 * shape as combined-health.ts's priority scan: the fleet is a few thousand
 * transformers and climbing, and a per-manufacturer round trip to the database
 * stops being usable well before it becomes slow enough to notice in testing.
 */

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
/** Event types that mean a unit has left service for good. */
const TERMINAL_EVENT_TYPES = new Set(["REPAIR_FAILED", "DISPOSED", "SCRAPPED"]);

export type ManufacturerPerformance = {
  id: string;
  name: string;
  country: string | null;
  unitsInFleet: number;
  /** % of units with at least one FAULT_REPORTED event. Null with no units. */
  failureRatePct: number | null;
  /** Average of (years to retirement if retired, else years in service so far). */
  avgServiceLifeYears: number | null;
  warrantyClaimsFiled: number;
  claimsSettled: number;
  claimsDisputed: number;
  mostCommonFault: string | null;
  /** MΩ/year — positive means declining (getting worse) over time. */
  avgIrDeclinePerYearMohm: number | null;
  /** kV/year — positive means declining (getting worse) over time. */
  avgBdvDeclinePerYearKv: number | null;
};

export async function buildManufacturerPerformance(): Promise<ManufacturerPerformance[]> {
  const [manufacturers, transformers, faultEvents, terminalEvents, claims, repairs, tests] = await Promise.all([
    prisma.manufacturer.findMany({ select: { id: true, name: true, country: true } }),
    prisma.transformer.findMany({
      select: { id: true, manufacturerId: true, yearOfManufacture: true, commissionDate: true },
    }),
    prisma.lifecycleEvent.findMany({
      where: { type: "FAULT_REPORTED" },
      select: { transformerId: true },
      distinct: ["transformerId"],
    }),
    prisma.lifecycleEvent.findMany({
      where: { type: { in: [...TERMINAL_EVENT_TYPES] as never[] } },
      orderBy: { occurredAt: "asc" },
      select: { transformerId: true, occurredAt: true },
    }),
    prisma.warrantyClaim.findMany({ select: { manufacturerId: true, status: true, faultReason: true } }),
    prisma.repairRecord.findMany({ select: { transformerId: true, faultCauseConfirmed: true } }),
    prisma.testRecord.findMany({
      where: { OR: [{ insulationResistanceHvMohm: { not: null } }, { oilBdvKv: { not: null } }] },
      orderBy: { testedAt: "asc" },
      select: { transformerId: true, testedAt: true, insulationResistanceHvMohm: true, oilBdvKv: true },
    }),
  ]);

  const faultedIds = new Set(faultEvents.map((e) => e.transformerId));
  const firstTerminal = new Map<string, Date>();
  for (const e of terminalEvents) if (!firstTerminal.has(e.transformerId)) firstTerminal.set(e.transformerId, e.occurredAt);

  const txById = new Map(transformers.map((t) => [t.id, t]));
  const now = Date.now();

  const testsByTx = new Map<string, typeof tests>();
  for (const t of tests) {
    const list = testsByTx.get(t.transformerId) ?? [];
    list.push(t);
    testsByTx.set(t.transformerId, list);
  }

  function declinePerYear(txIds: string[], field: "insulationResistanceHvMohm" | "oilBdvKv"): number | null {
    const rates: number[] = [];
    for (const id of txIds) {
      const series = (testsByTx.get(id) ?? []).filter((t) => t[field] != null);
      if (series.length < 2) continue;
      const first = series[0];
      const last = series[series.length - 1];
      const years = (last.testedAt.getTime() - first.testedAt.getTime()) / YEAR_MS;
      if (years < 0.1) continue; // too close together to mean anything
      rates.push(((first[field] as number) - (last[field] as number)) / years);
    }
    return rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : null;
  }

  const byManufacturer = new Map<string, string[]>(); // manufacturerId -> transformer ids
  for (const t of transformers) {
    const list = byManufacturer.get(t.manufacturerId) ?? [];
    list.push(t.id);
    byManufacturer.set(t.manufacturerId, list);
  }

  const claimsByManufacturer = new Map<string, typeof claims>();
  for (const c of claims) {
    const list = claimsByManufacturer.get(c.manufacturerId) ?? [];
    list.push(c);
    claimsByManufacturer.set(c.manufacturerId, list);
  }

  const repairsByTx = new Map<string, string[]>();
  for (const r of repairs) {
    if (!r.faultCauseConfirmed) continue;
    const list = repairsByTx.get(r.transformerId) ?? [];
    list.push(r.faultCauseConfirmed);
    repairsByTx.set(r.transformerId, list);
  }

  const rows: ManufacturerPerformance[] = manufacturers.map((m) => {
    const ids = byManufacturer.get(m.id) ?? [];
    const unitsInFleet = ids.length;

    const failureRatePct = unitsInFleet ? (ids.filter((id) => faultedIds.has(id)).length / unitsInFleet) * 100 : null;

    const serviceLifeYears = ids.map((id) => {
      const t = txById.get(id)!;
      const start = t.commissionDate ?? new Date(t.yearOfManufacture, 0, 1);
      const end = firstTerminal.get(id) ?? new Date(now);
      return Math.max(0, (end.getTime() - start.getTime()) / YEAR_MS);
    });
    const avgServiceLifeYears = serviceLifeYears.length
      ? serviceLifeYears.reduce((s, y) => s + y, 0) / serviceLifeYears.length
      : null;

    const mClaims = claimsByManufacturer.get(m.id) ?? [];
    const claimsSettled = mClaims.filter((c) => c.status === "APPROVED" || c.status === "CLOSED").length;
    const claimsDisputed = mClaims.filter((c) => c.status === "REJECTED").length;

    // Most common confirmed fault cause across every repair of this manufacturer's units.
    const faultCauses = ids.flatMap((id) => repairsByTx.get(id) ?? []);
    const faultCounts = new Map<string, number>();
    for (const f of faultCauses) faultCounts.set(f, (faultCounts.get(f) ?? 0) + 1);
    const mostCommonFault = [...faultCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      id: m.id,
      name: m.name,
      country: m.country,
      unitsInFleet,
      failureRatePct,
      avgServiceLifeYears,
      warrantyClaimsFiled: mClaims.length,
      claimsSettled,
      claimsDisputed,
      mostCommonFault,
      avgIrDeclinePerYearMohm: declinePerYear(ids, "insulationResistanceHvMohm"),
      avgBdvDeclinePerYearKv: declinePerYear(ids, "oilBdvKv"),
    };
  });

  // Worst failure rate first — units nobody has faulted read as 0%, which is
  // the honest bottom of the list, not a tie with "never measured".
  rows.sort((a, b) => (b.failureRatePct ?? -1) - (a.failureRatePct ?? -1));
  return rows;
}

/** Fleet-wide average for a numeric field, ignoring manufacturers with no data. */
export function fleetAverage(rows: ManufacturerPerformance[], key: keyof ManufacturerPerformance): number | null {
  const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

// Drill-down — every transformer from one manufacturer.

export type ManufacturerTransformerRow = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  siteName: string | null;
  status: string;
  ageYears: number;
  healthScore: number | null;
  faultCount: number;
};

export async function getManufacturerDetail(manufacturerId: string) {
  const manufacturer = await prisma.manufacturer.findUnique({ where: { id: manufacturerId } });
  if (!manufacturer) return null;

  const transformers = await prisma.transformer.findMany({
    where: { manufacturerId },
    select: {
      id: true, gNumber: true, serialNumber: true, currentSiteName: true, status: true,
      yearOfManufacture: true, electricalStressScore: true, physicalConditionScore: true,
      events: { where: { type: "FAULT_REPORTED" }, select: { id: true } },
    },
    orderBy: [{ status: "asc" }, { gNumber: "asc" }],
  });

  const claims = await prisma.warrantyClaim.findMany({
    where: { manufacturerId },
    include: { transformer: { select: { gNumber: true, serialNumber: true } } },
    orderBy: { createdAt: "desc" },
  });

  const tests = await prisma.testRecord.findMany({
    where: { transformer: { manufacturerId } },
    orderBy: { testedAt: "asc" },
    select: { transformerId: true, testedAt: true, insulationResistanceHvMohm: true, oilBdvKv: true, passed: true },
  });

  const rows: ManufacturerTransformerRow[] = transformers.map((t) => {
    const scores = [t.electricalStressScore, t.physicalConditionScore].filter((s): s is number => s != null);
    return {
      id: t.id,
      gNumber: t.gNumber,
      serialNumber: t.serialNumber,
      siteName: t.currentSiteName,
      status: t.status,
      ageYears: new Date().getFullYear() - t.yearOfManufacture,
      healthScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      faultCount: t.events.length,
    };
  });

  return { manufacturer, transformers: rows, claims, tests };
}
