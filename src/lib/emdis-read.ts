import "server-only";
import { prisma } from "./prisma";
import { analyseDataset, type DatasetAnalysis } from "./load-analysis";
import { computeThermal, type ThermalResult } from "./transformer-thermal";

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
};

/** Ambient for the thermal model. Nairobi runs 24-30 C; 28 is a fair working figure. */
export const ASSUMED_AMBIENT_C = 28;

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

  const analysis = analyseDataset(
    rows.map((r) => ({
      recordedAt: r.recordedAt,
      l1c: r.l1c, l2c: r.l2c, l3c: r.l3c, neutralC: r.neutralC,
      l1nV: r.l1nV, l2nV: r.l2nV, l3nV: r.l3nV,
      kva: r.kva, kw: r.kw, pf: r.pf, thdPct: r.thdPct, kwh: r.kwh,
    })),
    ratingKva,
    ds.nominalVoltLL,
    { fuseSizeA: insp?.fuseSizeA ?? null },
  );

  const pf = analysis.powerFactor?.median ?? 0.95;

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
      loadKva: analysis.peakKva, ratingKva, ambientC: ASSUMED_AMBIENT_C, powerFactor: pf,
    }),
    // The truth: the hot-spot sits in the winding carrying the most current.
    thermalByPhase: computeThermal({
      loadKva: (analysis.peakPhasePctRated / 100) * ratingKva,
      ratingKva, ambientC: ASSUMED_AMBIENT_C, powerFactor: pf,
    }),
  };
}

/** Datasets available, newest first. */
export async function listDatasets() {
  return prisma.emdisDataset.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      transformer: { select: { id: true, gNumber: true, serialNumber: true, ratingKva: true } },
    },
  });
}
