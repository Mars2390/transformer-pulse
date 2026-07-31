import "server-only";
import { prisma } from "./prisma";
import { LIMITS } from "./load-analysis";
import { bandOf, correctIrTo20C, wrDeviationPct, IR_LIMITS, EARTH_LIMIT_OHM, EARTH_CRITICAL_OHM } from "./insulation";

/**
 * Two scores, not one.
 *
 * The tempting design is a single 0-100 health number. It is the wrong design,
 * and the reason is operational rather than aesthetic: a transformer at 121% on
 * one phase with a sound pole, and a lightly loaded transformer on a rotten
 * pole, can land on the same blended figure — but they need different crews,
 * different materials and different urgency. Blending destroys the information
 * that makes the list actionable.
 *
 * So: ELECTRICAL STRESS from the meter, PHYSICAL CONDITION from the inspection,
 * and a single priority rank derived from both for the one ordered work queue.
 *
 * NULL means not measured. It is never 100. A transformer nobody has looked at
 * is not a healthy transformer, and a scoring system that says otherwise will
 * quietly bury the worst assets in the fleet.
 */

export type ScoreReason = { points: number; text: string };

// The physics lives in insulation.ts, with no database import, so it can be
// checked against a textbook without booting the application. Re-exported here
// so callers have one place to look.
export { correctIrTo20C, wrDeviationPct, bandOf, IR_LIMITS, EARTH_LIMIT_OHM, EARTH_CRITICAL_OHM } from "./insulation";

// ---------------------------------------------------------------------------

export type PriorityRow = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  region: string | null;
  substationCode: string | null;
  siteName: string | null;
  status: string;
  manufacturerId: string;
  manufacturerName: string;

  electrical: number | null;
  physical: number | null;
  priority: number;
  topReason: string;
  reasons: string[];

  lastInspectionAt: Date | null;
  structure: string | null;
  hasLoadData: boolean;
  peakPhasePct: number | null;
  unbalancePct: number | null;
  openEarth: boolean;
  fuseCarriersBad: boolean;
  irLowMohm: number | null;
};

/**
 * Score the whole fleet.
 *
 * Deliberately a small number of bulk queries rather than per-transformer work:
 * the register is a thousand units and climbing, and a scoring pass that issues
 * a query per asset stops being usable at exactly the point it becomes useful.
 */
export async function buildPriorityList(opts?: {
  region?: string | null;
  /** Score only these transformers — used for a single-unit lookup or a targeted cache refresh after an upload. */
  transformerIds?: string[];
  /** Score every status, not just IN_FIELD/FAULTY. The repair queue only wants units still in service; a cache
   *  refresh or a story-page lookup wants a score regardless of where the unit currently sits. */
  allStatuses?: boolean;
}): Promise<PriorityRow[]> {
  const where = {
    ...(opts?.region ? { region: opts.region } : {}),
    ...(opts?.allStatuses ? {} : { status: { in: ["IN_FIELD", "FAULTY"] as ("IN_FIELD" | "FAULTY")[] } }),
    ...(opts?.transformerIds ? { id: { in: opts.transformerIds } } : {}),
  };

  const transformers = await prisma.transformer.findMany({
    where,
    select: {
      id: true, gNumber: true, serialNumber: true, ratingKva: true, region: true,
      substationCode: true, currentSiteName: true, status: true,
      lastInspectionAt: true, structureCondition: true, yearOfManufacture: true,
      manufacturerId: true, manufacturer: { select: { name: true } },
    },
  });
  if (!transformers.length) return [];

  const ids = transformers.map((t) => t.id);

  // Latest inspection per transformer.
  const inspections = await prisma.substationInspection.findMany({
    where: { transformerId: { in: ids } },
    orderBy: { inspectedOn: "desc" },
    select: {
      transformerId: true, inspectedOn: true, structure: true, fuseCarriers: true,
      hvEarthOhm: true, hvEarthState: true, neutralEarthOhm: true, neutralEarthState: true,
      loadingOk: true, loadAction: true,
    },
  });
  const latestInspection = new Map<string, (typeof inspections)[0]>();
  for (const i of inspections) {
    if (i.transformerId && !latestInspection.has(i.transformerId)) latestInspection.set(i.transformerId, i);
  }

  // Worst load figures per transformer, from the hourly rollup rather than raw
  // readings — this is exactly why the rollup exists.
  const hourly = await prisma.emdisHourly.groupBy({
    by: ["transformerId"],
    where: { transformerId: { in: ids } },
    _max: { maxPhasePctRated: true, maxUnbalancePct: true, maxNeutralC: true, maxThdPct: true },
    _sum: { minutesOver100Pct: true, minutesOver80Pct: true },
  });
  const load = new Map(hourly.filter((h) => h.transformerId).map((h) => [h.transformerId!, h]));

  // Latest field diagnostic per transformer.
  const tests = await prisma.testRecord.findMany({
    where: { transformerId: { in: ids }, stage: "FIELD_DIAGNOSTIC" },
    orderBy: { testedAt: "desc" },
    select: {
      transformerId: true, irCorrectedTo20C: true, insulationResistanceHvMohm: true,
      polarizationIndex: true, windingResistanceHvOhm: true, windingResistanceLvOhm: true,
    },
  });
  const latestTest = new Map<string, (typeof tests)[0]>();
  for (const t of tests) if (!latestTest.has(t.transformerId)) latestTest.set(t.transformerId, t);

  const now = Date.now();
  const rows: PriorityRow[] = [];

  for (const t of transformers) {
    const insp = latestInspection.get(t.id);
    const ld = load.get(t.id);
    const tst = latestTest.get(t.id);

    // --- Electrical stress ------------------------------------------------
    let electrical: number | null = null;
    const eReasons: string[] = [];
    if (ld) {
      electrical = 100;
      const peak = ld._max.maxPhasePctRated ?? 0;
      const unb = ld._max.maxUnbalancePct ?? 0;
      const thd = ld._max.maxThdPct ?? 0;
      const overMin = ld._sum.minutesOver100Pct ?? 0;

      if (peak >= 100) { electrical -= 30; eReasons.push(`Phase reached ${peak.toFixed(0)}% of rated current`); }
      else if (peak >= 80) { electrical -= 15; eReasons.push(`Phase peaked at ${peak.toFixed(0)}% of rated`); }

      if (overMin > 60) { electrical -= 10; eReasons.push(`${(overMin / 60).toFixed(1)} h above rated current`); }

      if (unb >= LIMITS.unbalanceCritical) { electrical -= 25; eReasons.push(`Unbalance ${unb.toFixed(0)}%`); }
      else if (unb >= LIMITS.unbalanceWarn) { electrical -= 12; eReasons.push(`Unbalance ${unb.toFixed(0)}%`); }

      if (thd > LIMITS.thdVoltageLimit) { electrical -= 12; eReasons.push(`THD ${thd.toFixed(1)}%`); }
      else if (thd > LIMITS.thdCurrentLimit) { electrical -= 6; eReasons.push(`THD ${thd.toFixed(1)}%`); }

      electrical = Math.max(0, electrical);
    }

    // --- Physical condition -----------------------------------------------
    let physical: number | null = null;
    const pReasons: string[] = [];
    let openEarth = false;
    let irLow: number | null = null;

    if (insp || tst) {
      physical = 100;

      if (insp) {
        if (insp.structure === "ROTTEN") { physical -= 35; pReasons.push("Pole rotten"); }
        else if (insp.structure === "LEANING") { physical -= 20; pReasons.push("Pole leaning"); }

        const earthOpen = insp.hvEarthState === "OPEN_CIRCUIT" || insp.neutralEarthState === "OPEN_CIRCUIT";
        const earthVandalised = insp.hvEarthState === "VANDALISED" || insp.neutralEarthState === "VANDALISED";
        if (earthOpen) { physical -= 25; openEarth = true; pReasons.push("Earth read OL — over range, no effective earth"); }
        else if (earthVandalised) { physical -= 25; openEarth = true; pReasons.push("Earth conductor vandalised"); }
        else if ((insp.hvEarthOhm ?? 0) > EARTH_CRITICAL_OHM) { physical -= 15; pReasons.push(`HV earth ${insp.hvEarthOhm} Ω`); }
        else if ((insp.hvEarthOhm ?? 0) > EARTH_LIMIT_OHM) { physical -= 8; pReasons.push(`HV earth ${insp.hvEarthOhm} Ω, above ${EARTH_LIMIT_OHM} Ω`); }

        if (insp.fuseCarriers === "NEEDS_REPLACEMENT") { physical -= 12; pReasons.push("Fuse carriers need replacement"); }
        if (insp.loadingOk === false) { physical -= 10; pReasons.push(`Inspector flagged loading${insp.loadAction ? ` — ${insp.loadAction.replace(/_/g, " ").toLowerCase()}` : ""}`); }
      }

      if (tst) {
        const ir = tst.irCorrectedTo20C ?? tst.insulationResistanceHvMohm;
        if (ir != null) {
          irLow = ir;
          if (ir < IR_LIMITS.hardFloorMohm) { physical -= 50; pReasons.push(`Insulation resistance ${ir.toFixed(2)} MΩ — below 1 MΩ, do not energise`); }
          else if (ir < IR_LIMITS.criticalMohm) { physical -= 30; pReasons.push(`Insulation resistance ${ir.toFixed(0)} MΩ`); }
          else if (ir < IR_LIMITS.warnMohm) { physical -= 15; pReasons.push(`Insulation resistance ${ir.toFixed(0)} MΩ`); }
        }
        if (tst.polarizationIndex != null && tst.polarizationIndex < IR_LIMITS.piCritical) {
          physical -= 20; pReasons.push(`Polarization index ${tst.polarizationIndex.toFixed(2)} — insulation absorbing moisture`);
        }
        const dev = wrDeviationPct([tst.windingResistanceHvOhm, tst.windingResistanceLvOhm]);
        if (dev != null && dev > IR_LIMITS.wrDeviationCriticalPct) { physical -= 25; pReasons.push(`Winding resistance spread ${dev.toFixed(1)}%`); }
        else if (dev != null && dev > IR_LIMITS.wrDeviationWarnPct) { physical -= 12; pReasons.push(`Winding resistance spread ${dev.toFixed(1)}%`); }
      }

      // Absence of recent evidence, stated as such rather than assumed good.
      const days = t.lastInspectionAt ? (now - t.lastInspectionAt.getTime()) / 86_400_000 : null;
      if (days != null && days > 365) { physical -= 10; pReasons.push(`Last inspected ${(days / 365).toFixed(1)} years ago`); }

      physical = Math.max(0, physical);
    }

    // --- Priority ----------------------------------------------------------
    // min() dominates on purpose: either axis alone must be able to escalate a
    // unit. A sound pole does not excuse a cooking winding.
    const known = [electrical, physical].filter((x): x is number => x != null);
    const priority = known.length
      ? Math.round(Math.min(...known) * 0.7 + (known.reduce((s, x) => s + x, 0) / known.length) * 0.3)
      : 100;

    const reasons = [...pReasons, ...eReasons];

    rows.push({
      id: t.id, gNumber: t.gNumber, serialNumber: t.serialNumber, ratingKva: t.ratingKva,
      region: t.region, substationCode: t.substationCode, siteName: t.currentSiteName, status: t.status,
      manufacturerId: t.manufacturerId, manufacturerName: t.manufacturer.name,
      electrical, physical, priority,
      topReason: reasons[0] ?? "No defect recorded",
      reasons,
      lastInspectionAt: t.lastInspectionAt,
      structure: t.structureCondition,
      hasLoadData: Boolean(ld),
      peakPhasePct: ld?._max.maxPhasePctRated ?? null,
      unbalancePct: ld?._max.maxUnbalancePct ?? null,
      openEarth,
      fuseCarriersBad: insp?.fuseCarriers === "NEEDS_REPLACEMENT",
      irLowMohm: irLow,
    });
  }

  // Worst first, and among equals prefer the one we actually measured.
  rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.reasons.length) - (a.reasons.length);
  });

  return rows;
}

/**
 * Persist the cached scores so lists and maps do not recompute.
 *
 * Pass `transformerIds` to rescore only the units an upload just touched —
 * called after every EMDis/inspection commit — rather than the whole fleet on
 * every single file. Called with no arguments it refreshes everyone, which is
 * what a scheduled/manual full resync would want.
 */
export async function refreshCachedScores(opts?: { transformerIds?: string[] }): Promise<PriorityRow[]> {
  const rows = await buildPriorityList({ transformerIds: opts?.transformerIds, allStatuses: true });
  for (const r of rows) {
    await prisma.transformer.update({
      where: { id: r.id },
      data: {
        electricalStressScore: r.electrical,
        physicalConditionScore: r.physical,
        priorityRank: r.priority,
      },
    });
  }
  return rows;
}
