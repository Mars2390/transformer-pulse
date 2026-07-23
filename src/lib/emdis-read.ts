import "server-only";
import { prisma } from "./prisma";
import { analyseDataset, ratedPhaseCurrent, NOMINAL_VLN, LIMITS, type DatasetAnalysis } from "./load-analysis";
import { computeThermal, type ThermalResult } from "./transformer-thermal";
import {
  planBalance, assessCapacity, prognose, priceLossOfLife,
  whatIfMove, whatIfUprate, scoreVoltageQuality, ambientForMonth,
  type BalancePlan, type Capacity, type LifePrognosis, type LossOfLifeMoney,
  type WhatIfResult, type VoltageScorecard,
} from "./load-balancing";
import { estimateNewUnitCostKes } from "./repair-economics";

/**
 * Reading a dataset back out and analysing it.
 *
 * Shared by the load-analysis screen, the control room and the PDF report, so
 * all three quote the same numbers. Three views disagreeing about the same
 * transformer would undo the entire point.
 */

export type FullAnalysis = {
  dataset: {
    id: string;
    name: string;
    substationCode: string | null;
    serialAsRecorded: string | null;
    makeAsRecorded: string | null;
    firstReadingAt: Date;
    lastReadingAt: Date;
    readingCount: number;
    intervalSeconds: number;
    nominalVoltLL: number;
  };
  transformer: {
    id: string;
    gNumber: string | null;
    serialNumber: string;
    ratingKva: number;
    manufacturer: string;
    siteName: string | null;
    region: string | null;
    substationName: string | null;
  } | null;
  /** The most recent inspection, when one exists. This is what makes the
   *  screen tell a story rather than show a chart. */
  inspection: {
    inspectedOn: Date;
    inspectorRef: string;
    loadingOk: boolean | null;
    loadAction: string | null;
    fuseSizeA: number | null;
    structure: string | null;
    hvEarthOhm: number | null;
    hvEarthState: string;
    locationNote: string | null;
  } | null;
  analysis: DatasetAnalysis;
  /** Two thermal runs: what the kVA figure predicts, and what the hottest
   *  winding actually experiences. The gap between them is the finding. */
  thermalByKva: ThermalResult;
  thermalByPhase: ThermalResult;

  // --- The prescriptive layer ---------------------------------------------
  /** The ambient and voltage the analysis actually used, so a reader can see
   *  they were derived, not assumed. */
  environment: { voltLL: number; voltSource: string; ambientC: number; ambientSource: string };
  balance: BalancePlan;
  capacity: Capacity;
  prognosis: LifePrognosis;
  money: LossOfLifeMoney;
  whatIfBalance: WhatIfResult | null;
  whatIfUprate: WhatIfResult | null;
  scorecard: VoltageScorecard;
};

/** Ambient for the thermal model. Nairobi runs 24-30 C; 28 is a fair working figure. */
export const ASSUMED_AMBIENT_C = 28;

/**
 * Assumed current per single-phase customer at the evening peak, for turning an
 * amperage into a customer count. Deliberately a round, conservative figure —
 * a Kenyan domestic connection under load — and every screen that uses it says
 * "about N meters", never a precise count. Real meter-level data would replace
 * this with an exact list.
 */
export const ASSUMED_CUSTOMER_AMPS = 5;

export async function analyseDatasetById(datasetId: string): Promise<FullAnalysis | null> {
  const ds = await prisma.emdisDataset.findUnique({
    where: { id: datasetId },
    include: {
      transformer: {
        include: {
          manufacturer: { select: { name: true } },
          inspections: { orderBy: { inspectedOn: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!ds) return null;

  const rows = await prisma.emdisReading.findMany({
    where: { datasetId },
    orderBy: { recordedAt: "asc" },
  });
  if (!rows.length) return null;

  const ratingKva = ds.transformer?.ratingKva ?? ds.ratingKvaAsRecorded ?? 200;
  const insp = ds.transformer?.inspections?.[0] ?? null;

  // --- Voltage, now dynamic ------------------------------------------------
  // The rated current every per-phase judgement hangs on depends on the line
  // voltage. EMDis is LV-side metering, so the transformer's secondary voltage
  // is the right basis; fall back to the dataset's stored value, then to 415 V.
  // Before this it was hardcoded to 415, which would be wrong by a factor of ~26
  // for any 11 kV feeder reading.
  const secondaryV = ds.transformer?.secondaryKv ? ds.transformer.secondaryKv * 1000 : null;
  const voltLL = secondaryV && secondaryV > 100 ? secondaryV : ds.nominalVoltLL;

  const analysis = analyseDataset(
    rows.map((r) => ({
      recordedAt: r.recordedAt,
      l1c: r.l1c, l2c: r.l2c, l3c: r.l3c, neutralC: r.neutralC,
      l1nV: r.l1nV, l2nV: r.l2nV, l3nV: r.l3nV,
      kva: r.kva, kw: r.kw, pf: r.pf, thdPct: r.thdPct, kwh: r.kwh,
    })),
    ratingKva,
    voltLL,
    { fuseSizeA: insp?.fuseSizeA ?? null },
  );

  const pf = analysis.powerFactor?.median ?? 0.95;

  // --- Ambient, now dynamic ------------------------------------------------
  // A hardcoded 28 C makes the hot-spot optimistic on a hot afternoon. Keyed on
  // the month the data was actually recorded, a Nairobi seasonal figure is
  // closer to the truth, and still falls back to 28 C when the month is unknown.
  const ambientC = ambientForMonth(ds.firstReadingAt.getUTCMonth());

  const iRated = ratedPhaseCurrent(ratingKva, voltLL);

  // --- The worst single minute, for the balancing plan ---------------------
  // Balancing is planned against the actual currents at the peak, not against
  // three separate per-phase peaks that never happened at the same instant.
  let worst = rows[0];
  for (const r of rows) if ((r.maxPhaseC ?? 0) > (worst.maxPhaseC ?? 0)) worst = r;
  const worstCurrents = { l1: worst.l1c ?? 0, l2: worst.l2c ?? 0, l3: worst.l3c ?? 0 };

  const balance = planBalance(worstCurrents, ratingKva, voltLL, ASSUMED_CUSTOMER_AMPS);
  const capacity = assessCapacity(worstCurrents, ratingKva, voltLL, ASSUMED_CUSTOMER_AMPS);

  // --- Prognosis over the whole window -------------------------------------
  const perReadingHotspot = rows.map((r) => {
    const t = computeThermal({
      loadKva: ((r.maxPhasePctRated ?? 0) / 100) * ratingKva,
      ratingKva, ambientC, powerFactor: r.pf && r.pf > 0.1 ? r.pf : pf,
    });
    return t.hotspotC;
  });
  const prognosis = prognose(perReadingHotspot, analysis.spanHours);
  const money = priceLossOfLife(prognosis.avgAgeingRate, estimateNewUnitCostKes(ratingKva), analysis.spanHours);

  // --- What-if, precomputed for the two obvious interventions --------------
  const baseThermal = computeThermal({
    loadKva: (analysis.peakPhasePctRated / 100) * ratingKva, ratingKva, ambientC, powerFactor: pf,
  });
  const baselineForWhatIf = { hotspotC: baseThermal.hotspotC, ageingRate: baseThermal.ageingRate };
  const whatIfBalance = balance.moves.length
    ? whatIfMove(worstCurrents, ratingKva, voltLL, ambientC, pf, balance.moves[0], baselineForWhatIf)
    : null;
  const nextSize: Record<number, number> = { 50: 100, 100: 200, 200: 315, 315: 500, 500: 630, 630: 1000 };
  const whatIfUp = nextSize[ratingKva]
    ? whatIfUprate(worstCurrents, nextSize[ratingKva], voltLL, ambientC, pf, baselineForWhatIf)
    : null;

  // --- Voltage-quality scorecard -------------------------------------------
  const scorecard = scoreVoltageQuality({
    minVoltage: analysis.voltage?.min ?? null,
    maxVoltage: analysis.voltage?.max ?? null,
    nominalVln: NOMINAL_VLN,
    medianThd: analysis.thd?.median ?? null,
    thdLimit: LIMITS.thdVoltageLimit,
    medianHz: null,
    medianUnbalancePct: analysis.unbalance.median,
  });

  return {
    dataset: {
      id: ds.id, name: ds.name, substationCode: ds.substationCode,
      serialAsRecorded: ds.serialAsRecorded, makeAsRecorded: ds.makeAsRecorded,
      firstReadingAt: ds.firstReadingAt, lastReadingAt: ds.lastReadingAt,
      readingCount: ds.readingCount, intervalSeconds: ds.intervalSeconds,
      nominalVoltLL: ds.nominalVoltLL,
    },
    transformer: ds.transformer
      ? {
          id: ds.transformer.id,
          gNumber: ds.transformer.gNumber,
          serialNumber: ds.transformer.serialNumber,
          ratingKva: ds.transformer.ratingKva,
          manufacturer: ds.transformer.manufacturer.name,
          siteName: ds.transformer.currentSiteName,
          region: ds.transformer.region,
          substationName: ds.transformer.substationName,
        }
      : null,
    inspection: insp
      ? {
          inspectedOn: insp.inspectedOn,
          inspectorRef: insp.inspectorRef,
          loadingOk: insp.loadingOk,
          loadAction: insp.loadAction,
          fuseSizeA: insp.fuseSizeA,
          structure: insp.structure,
          hvEarthOhm: insp.hvEarthOhm,
          hvEarthState: insp.hvEarthState,
          locationNote: insp.locationNote,
        }
      : null,
    analysis,
    // The kVA view: what a conventional report would conclude.
    thermalByKva: computeThermal({
      loadKva: analysis.peakKva, ratingKva, ambientC, powerFactor: pf,
    }),
    // The truth: the hot-spot sits in the winding carrying the most current.
    thermalByPhase: baseThermal,

    environment: {
      voltLL,
      voltSource: secondaryV && secondaryV > 100 ? "transformer secondary voltage" : "default 415 V (LV)",
      ambientC,
      ambientSource: `Nairobi seasonal (${ds.firstReadingAt.toLocaleString("en", { month: "short", timeZone: "UTC" })})`,
    },
    balance,
    capacity,
    prognosis,
    money,
    whatIfBalance,
    whatIfUprate: whatIfUp,
    scorecard,
  };
}

void ASSUMED_AMBIENT_C;

/** Datasets available, newest first. */
export async function listDatasets() {
  return prisma.emdisDataset.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      transformer: { select: { id: true, gNumber: true, serialNumber: true, ratingKva: true } },
    },
  });
}
