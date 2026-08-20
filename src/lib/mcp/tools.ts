import "../server-guard";
import { z } from "zod";
import { prisma } from "../prisma";
import { buildPriorityList } from "../combined-health";
import { deriveHealthStatus, HEALTH_STATUS_META, type HealthStatusLevel } from "../health-status";
import { computeThermal } from "../transformer-thermal";
import { ambientForMonth, planBalance } from "../load-balancing";
import { snapshotMetricsFor } from "../snapshot-reading";
import { lifeFromAgeing, round3 } from "../time-to-failure";
import { ratedPhaseCurrent } from "../load-analysis";
import { computePhaseDistribution } from "../phase-distribution";
import { PHASE_META } from "../phase-colors";
import { buildManufacturerPerformance, fleetAverage } from "../manufacturer-performance";
import { computeWarranty } from "../warranty";
import { INSPECTION_OVERDUE } from "../report-data";

/**
 * The 8 read-only MCP tools.
 *
 * Every tool here is a pure async function: validate input with zod, query,
 * shape a clean structured object, return it. No tool ever returns a raw
 * Prisma row — a raw row carries columns nobody asked for. None of the 8
 * tools below surface a field that names a person at all (inspector/tester/
 * uploader identity is simply omitted); if a future tool needs to reference
 * who did something, mask it with maskEngineerName() from ./masking rather
 * than passing the real name through.
 */

const round0 = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function normaliseGNumber(input: string): string {
  return input.trim().replace(/^g[\s-]?/i, "");
}

async function findTransformerByGNumber(gNumberRaw: string) {
  const gNumber = normaliseGNumber(gNumberRaw);
  return prisma.transformer.findFirst({
    where: { OR: [{ gNumber }, { gNumber: gNumberRaw.trim() }] },
    include: { manufacturer: { select: { name: true } } },
  });
}

function healthPayload(level: HealthStatusLevel, explanation: string) {
  return { level, label: HEALTH_STATUS_META[level].label, explanation };
}

export type McpToolResult = Record<string, unknown>;
export type McpTool = {
  name: string;
  description: string;
  /** Used for actual validation inside each handler. */
  inputSchema: z.ZodTypeAny;
  /**
   * A hand-written JSON Schema for the MCP `tools/list` response — deliberately
   * NOT derived from the Zod schema above. Zod's internal representation
   * changes between major versions, and a schema-introspection helper that
   * breaks silently on the next `zod` bump would hand every client a wrong
   * tool description while validation kept working — the worst kind of bug,
   * invisible until someone tries a parameter that used to work.
   */
  jsonSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<McpToolResult>;
};

// 1. analyze_transformer_health

const AnalyzeHealthInput = z.object({
  gNumber: z.string().min(1, "gNumber is required").max(20),
});

async function analyzeTransformerHealth(args: unknown): Promise<McpToolResult> {
  const { gNumber } = AnalyzeHealthInput.parse(args);
  const tx = await findTransformerByGNumber(gNumber);
  if (!tx) return { found: false, message: `No transformer found with G-Number "${gNumber}".` };

  const [priorityRows, latestHour, latestInspection, recentAlerts] = await Promise.all([
    buildPriorityList({ transformerIds: [tx.id], allStatuses: true }),
    prisma.emdisHourly.findFirst({ where: { transformerId: tx.id }, orderBy: { hourStart: "desc" } }),
    prisma.substationInspection.findFirst({ where: { transformerId: tx.id }, orderBy: { inspectedOn: "desc" } }),
    prisma.alert.findMany({ where: { transformerId: tx.id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  const row = priorityRows[0] ?? null;
  const status = deriveHealthStatus({
    electrical: row?.electrical ?? null,
    physical: row?.physical ?? null,
    status: tx.status,
    reasons: row?.reasons ?? [],
  });

  let hotSpotTemperatureC: number | null = null;
  let hotSpotBasis: string | null = null;
  let hotSpotOnKvaBasisC: number | null = null;
  let ageingRate: number | null = null;
  let ageingRateOnKvaBasis: number | null = null;
  let estimatedTimeToFailureYears: number | null = null;
  let phaseLoadingPctOfRated: number | null = null;
  let loadingPctOfRated: number | null = null;
  let unbalancePct: number | null = null;
  let snapshotAt: string | null = null;
  let timeToFailureBasis: string | null = null;
  let timeToFailureCaveat: string | null = null;
  let thermalArithmetic: string | null = null;

  // One reading drives loading, unbalance, hot-spot, ageing and TTF. Driving
  // the thermal model off the hourly rollup while quoting unbalance from
  // somewhere else is how five numbers ended up describing five instants.
  const snap = await snapshotMetricsFor(tx.id, tx.ratingKva);

  if (snap.recordedAt) {
    snapshotAt = snap.recordedAt.toISOString();
    loadingPctOfRated = round2(snap.loadingPct);
    phaseLoadingPctOfRated = round1(snap.maxPhasePctRated);
    unbalancePct = round2(snap.unbalancePct);

    const ambientC = ambientForMonth(snap.recordedAt.getUTCMonth());

    // ------------------------------------------------------------------
    // K is the WORST phase, not the kVA figure.
    //
    // The hot-spot is a property of one winding — the one carrying the most
    // current — and IEC 60076-7 takes K as that winding's current over rated
    // current. kVA is a three-phase aggregate, so on an unbalanced unit it
    // reports something close to the MEAN of the phases and the hottest
    // winding disappears into the average.
    //
    // This is not a rounding difference. On G-153457 the phases read
    // 281.1 / 534.4 / 408.7 A against a 438.2 A rating. The kVA basis gives
    // K = 0.8820 and a hot-spot of 91.5 degC — "NORMAL", ageing at 0.47x.
    // The hottest winding is at K = 1.2195, a hot-spot of 129.8 degC, and
    // ageing at 39.5x. The tool was reporting a phase at 122% of rated in one
    // field and, in the next field, a temperature that could only be true if
    // no phase were above 89%.
    //
    // The rest of the system already drives the model off peak phase — the
    // control room, the load-analysis screen, the loss-of-life costing. This
    // call site was the one that did not.
    // ------------------------------------------------------------------
    const t = computeThermal({
      loadKva: (snap.maxPhasePctRated / 100) * tx.ratingKva,
      ratingKva: tx.ratingKva,
      ambientC,
      powerFactor: 0.95,
    });
    hotSpotTemperatureC = round1(t.hotspotC);
    ageingRate = round2(t.ageingRate);
    hotSpotBasis =
      `Hottest winding: K = ${(snap.maxPhasePctRated / 100).toFixed(4)} ` +
      `(${snap.hottestPhase ?? "worst phase"} at ${snap.maxPhaseC.toFixed(1)} A of ${snap.iRated.toFixed(1)} A rated), ` +
      `ambient ${ambientC} degC.`;
    thermalArithmetic =
      `top-oil rise ${t.topOilRiseK.toFixed(2)} K + gradient ${t.hotspotRiseK.toFixed(2)} K ` +
      `+ ambient ${ambientC} = ${t.hotspotC.toFixed(2)} degC; ` +
      `ageing 2^((${t.hotspotC.toFixed(2)} - 98) / 6) = ${t.ageingRate.toFixed(2)}x normal.`;

    // The kVA view is still reported, because the GAP between the two is the
    // finding: it is exactly how much heat a conventional kVA report hides on
    // an unbalanced transformer. Reported beside the real figure, never as it.
    const tKva = computeThermal({
      loadKva: (snap.loadingPct / 100) * tx.ratingKva,
      ratingKva: tx.ratingKva,
      ambientC,
      powerFactor: 0.95,
    });
    hotSpotOnKvaBasisC = round1(tKva.hotspotC);
    ageingRateOnKvaBasis = round2(tKva.ageingRate);

    // TTF is the exact inverse of the ageing rate above, to three decimals,
    // and it carries the life basis it was divided by. round1() printed 0.3
    // for 0.284, which no manual check could reproduce.
    const life = lifeFromAgeing(t.ageingRate);
    estimatedTimeToFailureYears = round3(life.yearsToEndOfLife);
    timeToFailureBasis = life.arithmetic;
    timeToFailureCaveat = life.caveat;
  }

  return {
    found: true,
    gNumber: tx.gNumber ? `G-${tx.gNumber}` : null,
    serialNumber: tx.serialNumber,
    manufacturer: tx.manufacturer.name,
    ratingKva: tx.ratingKva,
    status: tx.status,
    healthStatus: healthPayload(status.level, status.explanation),
    electricalStressScore: row?.electrical ?? null,
    physicalConditionScore: row?.physical ?? null,
    phaseLoadingPctOfRated,
    hotSpotTemperatureC,
    hotSpotBasis,
    thermalArithmetic,
    /** The same instant read as a conventional kVA report would read it. */
    hotSpotOnKvaBasisC,
    ageingRate,
    ageingRateOnKvaBasis,
    estimatedTimeToFailureYears,
    loadingPctOfRated,
    unbalancePct,
    snapshotAt,
    timeToFailureBasis,
    timeToFailureCaveat,
    lastInspection: latestInspection
      ? {
          date: latestInspection.inspectedOn.toISOString().slice(0, 10),
          structureCondition: latestInspection.structure,
          hvEarthState: latestInspection.hvEarthState,
          fuseCarriers: latestInspection.fuseCarriers,
        }
      : null,
    recentAlerts: recentAlerts.map((a) => ({
      type: a.type,
      severity: a.severity,
      message: a.message,
      acknowledged: a.acknowledged,
      occurredAt: a.createdAt.toISOString(),
    })),
  };
}

// 2. find_failing_transformers

const FindFailingInput = z.object({
  region: z.string().max(60).optional(),
  manufacturer: z.string().max(60).optional(),
  minAgeingRate: z.number().min(0).max(10_000).optional(),
});

async function findFailingTransformers(args: unknown): Promise<McpToolResult> {
  const { region, manufacturer, minAgeingRate } = FindFailingInput.parse(args);
  const rows = await buildPriorityList({ region, allStatuses: true });

  const ids = rows.map((r) => r.id);
  const hourly = ids.length
    ? await prisma.emdisHourly.groupBy({
        by: ["transformerId"],
        where: { transformerId: { in: ids } },
        _max: { maxPhasePctRated: true },
      })
    : [];
  const peakByTx = new Map(hourly.filter((h) => h.transformerId).map((h) => [h.transformerId!, h._max.maxPhasePctRated]));

  const enriched = rows
    .filter((r) => !manufacturer || r.manufacturerName.toLowerCase().includes(manufacturer.toLowerCase()))
    .map((r) => {
      const status = deriveHealthStatus({ electrical: r.electrical, physical: r.physical, status: r.status, reasons: r.reasons });
      const peakPct = peakByTx.get(r.id);
      let ageingRate: number | null = null;
      if (peakPct != null) {
        const ambientC = ambientForMonth(new Date().getUTCMonth());
        const t = computeThermal({ loadKva: (peakPct / 100) * r.ratingKva, ratingKva: r.ratingKva, ambientC, powerFactor: 0.95 });
        ageingRate = round2(t.ageingRate);
      }
      return { r, status, ageingRate };
    })
    .filter((x) => minAgeingRate == null || (x.ageingRate ?? 0) >= minAgeingRate)
    .sort((a, b) => a.r.priority - b.r.priority);

  return {
    region: region ?? "all regions",
    manufacturer: manufacturer ?? "all manufacturers",
    count: enriched.length,
    transformers: enriched.slice(0, 100).map(({ r, status, ageingRate }) => ({
      gNumber: r.gNumber ? `G-${r.gNumber}` : null,
      serialNumber: r.serialNumber,
      manufacturer: r.manufacturerName,
      region: r.region,
      site: r.siteName ?? r.substationCode,
      status: r.status,
      healthStatus: healthPayload(status.level, status.explanation),
      electricalStressScore: r.electrical,
      physicalConditionScore: r.physical,
      ageingRate,
      topReason: r.topReason,
    })),
  };
}

// 3. compare_manufacturers

async function compareManufacturers(): Promise<McpToolResult> {
  const rows = await buildManufacturerPerformance();
  return {
    fleetAverageFailureRatePct: round1(fleetAverage(rows, "failureRatePct") ?? 0),
    manufacturers: rows.map((r) => ({
      name: r.name,
      country: r.country,
      unitsInFleet: r.unitsInFleet,
      failureRatePct: r.failureRatePct != null ? round1(r.failureRatePct) : null,
      avgServiceLifeYears: r.avgServiceLifeYears != null ? round1(r.avgServiceLifeYears) : null,
      warrantyClaimsFiled: r.warrantyClaimsFiled,
      claimsSettled: r.claimsSettled,
      claimsDisputed: r.claimsDisputed,
      mostCommonFault: r.mostCommonFault,
      avgIrDeclinePerYearMohm: r.avgIrDeclinePerYearMohm != null ? round2(r.avgIrDeclinePerYearMohm) : null,
      avgBdvDeclinePerYearKv: r.avgBdvDeclinePerYearKv != null ? round2(r.avgBdvDeclinePerYearKv) : null,
    })),
  };
}

// 4. analyze_load_pattern

async function analyzeLoadPattern(args: unknown): Promise<McpToolResult> {
  const { gNumber } = AnalyzeHealthInput.parse(args);
  const tx = await findTransformerByGNumber(gNumber);
  if (!tx) return { found: false, message: `No transformer found with G-Number "${gNumber}".` };

  const latestHour = await prisma.emdisHourly.findFirst({ where: { transformerId: tx.id }, orderBy: { hourStart: "desc" } });
  if (!latestHour) {
    return { found: true, gNumber: tx.gNumber ? `G-${tx.gNumber}` : null, hasLoadData: false, message: "No EMDis load data is linked to this transformer yet." };
  }

  const voltLL = tx.secondaryKv ? tx.secondaryKv * 1000 : 415;
  const snap = await snapshotMetricsFor(tx.id, tx.ratingKva);
  const iRated = snap.iRated > 0 ? snap.iRated : ratedPhaseCurrent(tx.ratingKva, voltLL);

  // maxL1c, maxL2c and maxL3c are three separate peaks from three different
  // minutes. Treating them as one reading invents imbalance the transformer
  // never saw - it is where the 63% came from. These three are simultaneous.
  const currents = { l1: snap.l1c, l2: snap.l2c, l3: snap.l3c };
  const distribution = computePhaseDistribution({ currents, ratedPhaseA: iRated, ratingKva: tx.ratingKva });
  const balance = planBalance(currents, tx.ratingKva, voltLL, 5);

  return {
    found: true,
    hasLoadData: true,
    gNumber: tx.gNumber ? `G-${tx.gNumber}` : null,
    ratedPhaseA: round1(iRated),
    lastReadingAt: latestHour.hourStart.toISOString(),
    phases: distribution.phases.map((p) => ({
      phase: p.phase,
      colour: PHASE_META[p.phase].word,
      amps: round1(p.amps),
      pctOfRated: round1(p.pctRated),
      status: p.status.label,
      estimatedCustomers: p.estimatedCustomers,
    })),
    neutralCurrentA: round1(snap.neutralC),
    unbalancePct: round2(snap.unbalancePct),
    snapshotAt: snap.recordedAt ? snap.recordedAt.toISOString() : null,
    minutesOverRatedLastHour: latestHour.minutesOver100Pct,
    overloaded: distribution.heaviest.pctRated >= 100,
    heaviestPhase: distribution.heaviest.phase,
    loadBalancingRecommendation: balance.feasible
      ? `Move ${balance.totalAmpsToMove} A total (${balance.moves.map((m) => `${m.amps} A from ${PHASE_META[m.from].word} to ${PHASE_META[m.to].word}`).join("; ")}) — brings every phase to about ${round0(balance.targetA)} A.`
      : balance.note,
  };
}

// 5. list_inspection_defects

const DefectInput = z.object({
  region: z.string().max(60).optional(),
  defectType: z.enum(["rotten_poles", "open_earths", "fuse_carriers", "all"]).default("all"),
});

async function listInspectionDefects(args: unknown): Promise<McpToolResult> {
  const { region, defectType } = DefectInput.parse(args);

  const inspections = await prisma.substationInspection.findMany({
    where: region ? { region } : {},
    orderBy: { inspectedOn: "desc" },
    include: { transformer: { select: { gNumber: true, serialNumber: true, currentSiteName: true, region: true } } },
  });

  const latestPerTx = new Map<string, (typeof inspections)[number]>();
  for (const i of inspections) {
    if (i.transformerId && !latestPerTx.has(i.transformerId)) latestPerTx.set(i.transformerId, i);
  }

  const isOpenEarth = (i: (typeof inspections)[number]) => i.hvEarthState === "OPEN_CIRCUIT" || i.neutralEarthState === "OPEN_CIRCUIT";
  const isRottenPole = (i: (typeof inspections)[number]) => i.structure === "ROTTEN" || i.structure === "LEANING";
  const isFuseBad = (i: (typeof inspections)[number]) => i.fuseCarriers === "NEEDS_REPLACEMENT";

  const rows = [...latestPerTx.values()].filter((i) => {
    if (defectType === "rotten_poles") return isRottenPole(i);
    if (defectType === "open_earths") return isOpenEarth(i);
    if (defectType === "fuse_carriers") return isFuseBad(i);
    return isRottenPole(i) || isOpenEarth(i) || isFuseBad(i);
  });

  const severity = (i: (typeof inspections)[number]) => (isOpenEarth(i) ? 0 : i.structure === "ROTTEN" ? 1 : i.structure === "LEANING" ? 2 : 3);
  rows.sort((a, b) => severity(a) - severity(b));

  return {
    region: region ?? "all regions",
    defectType,
    count: rows.length,
    transformers: rows.slice(0, 100).map((i) => ({
      gNumber: i.transformer?.gNumber ? `G-${i.transformer.gNumber}` : null,
      serialNumber: i.transformer?.serialNumber ?? null,
      site: i.transformer?.currentSiteName ?? [i.substationCode, i.substationName].filter(Boolean).join(" — "),
      region: i.transformer?.region ?? i.region,
      structureCondition: i.structure,
      hvEarthState: i.hvEarthState,
      hvEarthOhm: i.hvEarthOhm,
      neutralEarthState: i.neutralEarthState,
      fuseCarriers: i.fuseCarriers,
      inspectedOn: i.inspectedOn.toISOString().slice(0, 10),
    })),
  };
}

// 6. get_fleet_summary

const RegionInput = z.object({ region: z.string().max(60).optional() });

async function getFleetSummary(args: unknown): Promise<McpToolResult> {
  const { region } = RegionInput.parse(args);
  const where = region ? { region } : {};

  const [statusCounts, priorityRows, inFieldUnits, claims] = await Promise.all([
    prisma.transformer.groupBy({ by: ["status"], where, _count: { _all: true } }),
    buildPriorityList({ region, allStatuses: true }),
    prisma.transformer.findMany({ where: { ...where, status: "IN_FIELD" }, select: { lastInspectionAt: true } }),
    prisma.warrantyClaim.findMany({ where: { status: { in: ["OPEN", "SUBMITTED"] }, transformer: where }, select: { claimValueKes: true } }),
  ]);

  const byHealth: Record<HealthStatusLevel, number> = { HEALTHY: 0, BREATHING: 0, SURVIVING: 0, CRITICAL: 0, DECEASED: 0, UNVERIFIED: 0 };
  for (const row of priorityRows) {
    const status = deriveHealthStatus({ electrical: row.electrical, physical: row.physical, status: row.status, reasons: row.reasons });
    byHealth[status.level]++;
  }

  const compliant = inFieldUnits.filter(
    (t) => t.lastInspectionAt && (Date.now() - t.lastInspectionAt.getTime()) / 86_400_000 <= INSPECTION_OVERDUE,
  ).length;
  const inspectionCompliancePct = inFieldUnits.length ? round0((compliant / inFieldUnits.length) * 100) : null;

  const recoverableKes = claims.reduce((s, c) => s + Number(c.claimValueKes ?? 0), 0);

  return {
    region: region ?? "all regions",
    totalTransformers: statusCounts.reduce((s, c) => s + c._count._all, 0),
    byStatus: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
    byHealth,
    inspectionCompliancePct,
    openWarrantyClaimsValueKes: round0(recoverableKes),
    openWarrantyClaimsCount: claims.length,
  };
}

// 7. analyze_warranty_claims

const ClaimsInput = z.object({
  manufacturer: z.string().max(60).optional(),
  status: z.enum(["OPEN", "SUBMITTED", "APPROVED", "REJECTED", "CLOSED"]).optional(),
});

async function analyzeWarrantyClaims(args: unknown): Promise<McpToolResult> {
  const { manufacturer, status } = ClaimsInput.parse(args);

  const claims = await prisma.warrantyClaim.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(manufacturer ? { manufacturer: { name: { contains: manufacturer, mode: "insensitive" } } } : {}),
    },
    include: {
      manufacturer: { select: { name: true } },
      transformer: { select: { gNumber: true, serialNumber: true, warrantyStart: true, warrantyMonths: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const rows = claims.map((c) => {
    const w = computeWarranty(c.transformer.warrantyStart, c.transformer.warrantyMonths);
    return {
      gNumber: c.transformer.gNumber ? `G-${c.transformer.gNumber}` : null,
      serialNumber: c.transformer.serialNumber,
      manufacturer: c.manufacturer.name,
      status: c.status,
      faultReason: c.faultReason,
      claimValueKes: c.claimValueKes != null ? Number(c.claimValueKes) : null,
      transformerWarrantyDaysRemaining: w.daysRemaining,
      raisedOn: c.createdAt.toISOString().slice(0, 10),
    };
  });

  const totalRecoverableKes = rows
    .filter((r) => r.status === "OPEN" || r.status === "SUBMITTED")
    .reduce((s, r) => s + (r.claimValueKes ?? 0), 0);

  return {
    manufacturer: manufacturer ?? "all manufacturers",
    status: status ?? "all statuses",
    count: rows.length,
    totalRecoverableKes: round0(totalRecoverableKes),
    claims: rows,
  };
}

// 8. search_transformers

const SearchInput = z.object({ query: z.string().min(1, "query is required").max(100) });

async function searchTransformers(args: unknown): Promise<McpToolResult> {
  const { query } = SearchInput.parse(args);
  const q = query.trim();
  const gNumberQuery = normaliseGNumber(q);

  const results = await prisma.transformer.findMany({
    where: {
      OR: [
        { gNumber: { contains: gNumberQuery, mode: "insensitive" } },
        { serialNumber: { contains: q, mode: "insensitive" } },
        { currentSiteName: { contains: q, mode: "insensitive" } },
        { substationName: { contains: q, mode: "insensitive" } },
        { manufacturer: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: { manufacturer: { select: { name: true } } },
    take: 25,
  });

  return {
    query: q,
    count: results.length,
    transformers: results.map((t) => {
      const status = deriveHealthStatus({ electrical: t.electricalStressScore, physical: t.physicalConditionScore, status: t.status });
      return {
        gNumber: t.gNumber ? `G-${t.gNumber}` : null,
        serialNumber: t.serialNumber,
        manufacturer: t.manufacturer.name,
        ratingKva: t.ratingKva,
        status: t.status,
        site: t.currentSiteName ?? t.substationName,
        region: t.region,
        healthStatus: healthPayload(status.level, status.explanation),
      };
    }),
  };
}

// Registry

export const MCP_TOOLS: McpTool[] = [
  {
    name: "analyze_transformer_health",
    description:
      "Get a complete health analysis for one transformer by G-Number: health status, electrical and physical scores, phase loading, hot-spot temperature, ageing rate, estimated time to failure, last inspection, and recent alerts.",
    inputSchema: AnalyzeHealthInput,
    jsonSchema: {
      type: "object",
      properties: { gNumber: { type: "string", description: "The transformer's G-Number, e.g. \"G-153457\" or \"153457\"." } },
      required: ["gNumber"],
    },
    handler: analyzeTransformerHealth,
  },
  {
    name: "find_failing_transformers",
    description:
      "Find transformers with critical health issues, worst first. Optionally filter by region, manufacturer, or a minimum insulation ageing rate.",
    inputSchema: FindFailingInput,
    jsonSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: "e.g. \"Nairobi West\"" },
        manufacturer: { type: "string", description: "Matches partially, e.g. \"ABB\"" },
        minAgeingRate: { type: "number", description: "Only include transformers ageing at least this many times faster than normal." },
      },
    },
    handler: findFailingTransformers,
  },
  {
    name: "compare_manufacturers",
    description:
      "Compare failure rate, average service life, warranty claims, most common fault, and IR/BDV decline across every manufacturer in the fleet.",
    inputSchema: z.object({}),
    jsonSchema: { type: "object", properties: {} },
    handler: compareManufacturers,
  },
  {
    name: "analyze_load_pattern",
    description:
      "Analyse per-phase load for one transformer by G-Number: L1/L2/L3 (Red/Yellow/Blue) currents, loading %, unbalance, neutral current, overload duration, and a load-balancing recommendation.",
    inputSchema: AnalyzeHealthInput,
    jsonSchema: {
      type: "object",
      properties: { gNumber: { type: "string", description: "The transformer's G-Number, e.g. \"G-153457\" or \"153457\"." } },
      required: ["gNumber"],
    },
    handler: analyzeLoadPattern,
  },
  {
    name: "list_inspection_defects",
    description:
      "Find safety defects recorded in KYN inspections — rotten/leaning poles, open earths, or fuse carriers needing replacement — optionally scoped to a region.",
    inputSchema: DefectInput,
    jsonSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: "e.g. \"Nairobi West\"" },
        defectType: { type: "string", enum: ["rotten_poles", "open_earths", "fuse_carriers", "all"], description: "Defaults to \"all\"." },
      },
    },
    handler: listInspectionDefects,
  },
  {
    name: "get_fleet_summary",
    description:
      "High-level fleet statistics: totals by status and by health level, inspection compliance rate, and open warranty claim value — optionally scoped to a region.",
    inputSchema: RegionInput,
    jsonSchema: { type: "object", properties: { region: { type: "string", description: "e.g. \"Nairobi West\". Omit for the whole fleet." } } },
    handler: getFleetSummary,
  },
  {
    name: "analyze_warranty_claims",
    description:
      "List and total warranty claims, optionally filtered by manufacturer or status, including recoverable KES value and days remaining on the transformer's warranty.",
    inputSchema: ClaimsInput,
    jsonSchema: {
      type: "object",
      properties: {
        manufacturer: { type: "string", description: "Matches partially, e.g. \"PANFRICA\"" },
        status: { type: "string", enum: ["OPEN", "SUBMITTED", "APPROVED", "REJECTED", "CLOSED"] },
      },
    },
    handler: analyzeWarrantyClaims,
  },
  {
    name: "search_transformers",
    jsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "G-Number, serial number, location name, or manufacturer." } },
      required: ["query"],
    },
    description:
      "Search transformers by G-Number, serial number, site/location name, or manufacturer. Returns matches with basic health status.",
    inputSchema: SearchInput,
    handler: searchTransformers,
  },
];

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}
