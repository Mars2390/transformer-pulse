import "./server-guard";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { analyseReading, ratedPhaseCurrent, NOMINAL_VLL } from "./load-analysis";
import { rollupHourly } from "./emdis-rollup";
import { raiseLoadAlerts } from "./emdis-import";
import { refreshCachedScores } from "./combined-health";
import { deriveHealthStatus } from "./health-status";
import { computeEventHash, CURRENT_HASH_VERSION } from "./chain";

/**
 * Managing load datasets after they are in: listing, deleting, and promoting
 * staged data into the analysis.
 *
 * ---------------------------------------------------------------------------
 * The rule every function here obeys
 * ---------------------------------------------------------------------------
 * A transformer's health score is CACHED — electricalStressScore and
 * physicalConditionScore are columns, computed from the load data at the moment
 * it arrives. So any change to which readings exist is only half an operation.
 * Delete a dataset without rescoring and the register goes on reporting a
 * transformer as CRITICAL on the strength of readings that are no longer there,
 * with no way for anyone to find out why.
 *
 * Every function below therefore ends by rescoring the transformers it touched.
 * Not as tidiness — it is the half of the operation that makes the other half
 * true.
 */

export type DatasetRow = {
  id: string;
  name: string;
  transformerId: string | null;
  transformerLabel: string | null;
  transformerRatingKva: number | null;
  substationCode: string | null;
  serialAsRecorded: string | null;
  ratingKvaAsRecorded: number | null;
  resolvedBy: string;
  firstReadingAt: Date;
  lastReadingAt: Date;
  readingCount: number;
  intervalSeconds: number;
  uploadedByName: string;
  createdAt: Date;
  staged: boolean;
  stagingReason: string | null;
  duplicateKind: string | null;
  duplicateOf: { id: string; name: string } | null;
  /** Alerts standing on this dataset, which deleting it would withdraw. */
  alertCount: number;
};

const LIST_INCLUDE = {
  transformer: { select: { gNumber: true, serialNumber: true, ratingKva: true } },
  duplicateOf: { select: { id: true, name: true } },
  _count: { select: { alerts: true } },
} as const;

type ListedDataset = Prisma.EmdisDatasetGetPayload<{ include: typeof LIST_INCLUDE }>;

function toRow(d: ListedDataset): DatasetRow {
  return {
    id: d.id,
    name: d.name,
    transformerId: d.transformerId,
    transformerLabel: d.transformer?.gNumber ?? d.transformer?.serialNumber ?? null,
    transformerRatingKva: d.transformer?.ratingKva ?? null,
    substationCode: d.substationCode,
    serialAsRecorded: d.serialAsRecorded,
    ratingKvaAsRecorded: d.ratingKvaAsRecorded,
    resolvedBy: d.resolvedBy,
    firstReadingAt: d.firstReadingAt,
    lastReadingAt: d.lastReadingAt,
    readingCount: d.readingCount,
    intervalSeconds: d.intervalSeconds,
    uploadedByName: d.uploadedByName,
    createdAt: d.createdAt,
    staged: d.staged,
    stagingReason: d.stagingReason,
    duplicateKind: d.duplicateKind,
    duplicateOf: d.duplicateOf,
    alertCount: d._count.alerts,
  };
}

/**
 * Datasets that are part of the analysis, newest first.
 *
 * Staged ones are excluded by design: this list is the answer to "what is the
 * system reading its numbers from", and staged data is precisely what it is
 * not reading them from. They have their own queue.
 */
export async function listActiveDatasets(): Promise<DatasetRow[]> {
  const rows = await prisma.emdisDataset.findMany({
    where: { staged: false },
    orderBy: { createdAt: "desc" },
    include: LIST_INCLUDE,
  });
  return rows.map(toRow);
}

/** The staging queue: parsed, stored, and deliberately kept out of the analysis. */
export async function listStagedDatasets(): Promise<DatasetRow[]> {
  const rows = await prisma.emdisDataset.findMany({
    where: { staged: true },
    orderBy: { createdAt: "desc" },
    include: LIST_INCLUDE,
  });
  return rows.map(toRow);
}

export type DeleteResult = {
  deleted: number;
  readingsRemoved: number;
  alertsWithdrawn: number;
  /** Transformers whose cached health was recomputed, and what it is now. */
  rescored: { transformerId: string; label: string; level: string; explanation: string }[];
};

/**
 * Delete datasets and put the register back into a consistent state.
 *
 * Readings, hourly rollups and the alerts raised from them cascade — see the
 * relations on EmdisDataset. What does NOT cascade, and must not, is the
 * LOAD_CHECK_RECORDED lifecycle event: the chain is hash-linked and
 * append-only, and removing a link from the middle of it would break the
 * verification of every event after it. The event says a load check happened on
 * a given day, which remains true after the readings are cleared — so it stays,
 * and it stays honest.
 */
export async function deleteDatasets(ids: readonly string[]): Promise<DeleteResult> {
  if (!ids.length) {
    return { deleted: 0, readingsRemoved: 0, alertsWithdrawn: 0, rescored: [] };
  }

  const doomed = await prisma.emdisDataset.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true, transformerId: true, readingCount: true,
      _count: { select: { alerts: true } },
    },
  });
  if (!doomed.length) {
    return { deleted: 0, readingsRemoved: 0, alertsWithdrawn: 0, rescored: [] };
  }

  const affected = [...new Set(doomed.map((d) => d.transformerId).filter((v): v is string => !!v))];
  const readingsRemoved = doomed.reduce((s, d) => s + d.readingCount, 0);
  const alertsWithdrawn = doomed.reduce((s, d) => s + d._count.alerts, 0);

  const result = await prisma.emdisDataset.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });

  return {
    deleted: result.count,
    readingsRemoved,
    alertsWithdrawn,
    rescored: await rescore(affected),
  };
}

/**
 * Remove every load dataset.
 *
 * The count is read first and returned, so the caller can state what was
 * actually removed rather than what was asked for — a manager who is told "all
 * load data cleared" deserves to know whether that was 3 datasets or 300.
 */
export async function clearAllDatasets(): Promise<DeleteResult> {
  const all = await prisma.emdisDataset.findMany({ select: { id: true } });
  return deleteDatasets(all.map((d) => d.id));
}

export type ApprovalResult = {
  datasetId: string;
  transformerLabel: string;
  readings: number;
  alertsRaised: number;
  /** True when the register's rating differed from the file's, so every
   *  percentage in this dataset was recomputed against the right rated current. */
  recomputed: boolean;
  ratingKva: number;
  health: { level: string; explanation: string } | null;
};

/**
 * Approve a staged dataset: name its transformer and let it into the analysis.
 *
 * The rating is the reason this is more than an UPDATE of one column. Every
 * percentage stored on every reading — loadingPct, maxPhasePctRated,
 * neutralPctRated — is a ratio against rated current, and rated current comes
 * from the rating. While the block was staged the only rating available was the
 * file header's, or the 200 kVA fallback. The moment a human attaches it to a
 * real transformer, the register's rating becomes the one to trust, and if it
 * differs then every one of those percentages is now wrong.
 *
 * So the readings are re-analysed, the rollup is rebuilt from them, and only
 * then are the alerts raised and the load check written to the chain. Approving
 * a 315 kVA unit's data that was analysed as 200 kVA would otherwise report a
 * 63% load as 100% and raise a critical overload that never happened.
 */
export async function approveStagedDataset(
  datasetId: string,
  transformerId: string,
  actor: { id: string; name: string },
): Promise<ApprovalResult> {
  const ds = await prisma.emdisDataset.findUnique({
    where: { id: datasetId },
    select: {
      id: true, staged: true, nominalVoltLL: true, ratingKvaAsRecorded: true,
      intervalSeconds: true, readingCount: true,
    },
  });
  if (!ds) throw new Error("That staged dataset no longer exists.");
  if (!ds.staged) throw new Error("That dataset is already part of the analysis.");

  const tx = await prisma.transformer.findUnique({
    where: { id: transformerId },
    select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, secondaryKv: true },
  });
  if (!tx) throw new Error("That transformer is not on the register.");

  const label = tx.gNumber ?? tx.serialNumber;

  // The same voltage basis analyseDatasetById() uses when it reads back out, so
  // the approval and the analysis screen cannot disagree about rated current.
  const secondaryV = tx.secondaryKv ? tx.secondaryKv * 1000 : null;
  const voltLL = secondaryV && secondaryV > 100 ? secondaryV : ds.nominalVoltLL || NOMINAL_VLL;
  const ratingKva = tx.ratingKva || ds.ratingKvaAsRecorded || 200;
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);

  const stagedBasis = ds.ratingKvaAsRecorded ?? 200;
  const recomputed = stagedBasis !== ratingKva || voltLL !== ds.nominalVoltLL;

  const readings = await prisma.emdisReading.findMany({
    where: { datasetId },
    orderBy: { recordedAt: "asc" },
  });

  // Re-derive every stored percentage against the rating we now trust.
  const analysed = readings.map((r) => {
    const a = analyseReading(r, ratingKva, voltLL);
    return {
      ...r,
      maxPhaseC: a.maxPhaseC,
      phaseUnbalancePct: a.unbalancePct,
      loadingPct: a.loadingPct,
      maxPhasePctRated: a.maxPhasePctRated,
      neutralPctRated: iRated > 0 ? ((r.neutralC ?? 0) / iRated) * 100 : 0,
    };
  });

  if (recomputed) {
    // Chunked rather than one transaction over the whole dataset: a year of
    // one-minute data is half a million rows, and a single transaction that
    // large will hit Postgres's statement timeout long before it commits.
    const CHUNK = 500;
    for (let i = 0; i < analysed.length; i += CHUNK) {
      await prisma.$transaction(
        analysed.slice(i, i + CHUNK).map((r) =>
          prisma.emdisReading.update({
            where: { id: r.id },
            data: {
              maxPhaseC: r.maxPhaseC,
              phaseUnbalancePct: r.phaseUnbalancePct,
              loadingPct: r.loadingPct,
              maxPhasePctRated: r.maxPhasePctRated,
              neutralPctRated: r.neutralPctRated,
            },
          }),
        ),
      );
    }
  }

  // The rollup is rebuilt from scratch, not patched. Its per-hour minutes over
  // rated depend on iRated, which has just changed.
  await prisma.emdisHourly.deleteMany({ where: { datasetId } });
  const hourly = rollupHourly(analysed, {
    datasetId,
    transformerId,
    intervalSeconds: ds.intervalSeconds || 60,
    iRated,
  });
  for (let i = 0; i < hourly.length; i += 500) {
    await prisma.emdisHourly.createMany({ data: hourly.slice(i, i + 500), skipDuplicates: true });
  }

  await prisma.emdisDataset.update({
    where: { id: datasetId },
    data: {
      transformerId,
      resolvedBy: "MANUAL",
      staged: false,
      stagingReason: null,
      nominalVoltLL: voltLL,
    },
  });

  const alertsRaised = await raiseLoadAlerts(transformerId, datasetId, analysed, iRated, ratingKva);

  await writeApprovalEvent(transformerId, actor, {
    readings: analysed.length,
    from: analysed[0]?.recordedAt ?? new Date(),
    to: analysed[analysed.length - 1]?.recordedAt ?? new Date(),
    peakPhasePct: analysed.length ? Math.max(...analysed.map((r) => r.maxPhasePctRated ?? 0)) : 0,
    ratingKva,
  });

  const [health] = await rescore([transformerId]);

  return {
    datasetId,
    transformerLabel: label,
    readings: analysed.length,
    alertsRaised,
    recomputed,
    ratingKva,
    health: health ? { level: health.level, explanation: health.explanation } : null,
  };
}

/**
 * Discard a staged dataset.
 *
 * A plain delete, and safe as one: staged data has no transformer, so it raised
 * no alerts, wrote nothing to any chain, and contributed to no score. Nothing
 * downstream needs putting right, because nothing downstream ever saw it.
 */
export async function discardStagedDataset(datasetId: string): Promise<{ readings: number }> {
  const ds = await prisma.emdisDataset.findUnique({
    where: { id: datasetId },
    select: { staged: true, readingCount: true },
  });
  if (!ds) throw new Error("That staged dataset no longer exists.");
  if (!ds.staged) {
    throw new Error(
      "That dataset is already part of the analysis and cannot be discarded from the staging queue. " +
        "Delete it from the load data page instead, where the effect on the transformer is stated.",
    );
  }
  await prisma.emdisDataset.delete({ where: { id: datasetId } });
  return { readings: ds.readingCount };
}

/** Recompute cached health for the given transformers and describe the result. */
async function rescore(transformerIds: readonly string[]) {
  if (!transformerIds.length) return [];
  const scored = await refreshCachedScores({ transformerIds: [...transformerIds] });
  return scored.map((row) => {
    const { level, explanation } = deriveHealthStatus({
      electrical: row.electrical,
      physical: row.physical,
      status: row.status,
      reasons: row.reasons,
    });
    return {
      transformerId: row.id,
      label: row.gNumber ?? row.serialNumber ?? row.id,
      level,
      explanation,
    };
  });
}

/**
 * The load check goes on the chain at approval, not at upload.
 *
 * Deliberately worded as an approval rather than as an import: the event is a
 * record of a named human deciding that this data belongs to this transformer,
 * which is a different and more consequential claim than "a file was uploaded".
 */
async function writeApprovalEvent(
  transformerId: string,
  actor: { id: string; name: string },
  info: { readings: number; from: Date; to: Date; peakPhasePct: number; ratingKva: number },
) {
  const t = await prisma.transformer.findUnique({
    where: { id: transformerId },
    select: { lastEventHash: true, status: true },
  });
  if (!t) return;

  const occurredAt = info.to;
  const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  const notes =
    `Load check approved from staging by ${actor.name}. ` +
    `${info.readings} readings, ${stamp(info.from)} to ${stamp(info.to)} UTC. ` +
    `Peak phase current reached ${info.peakPhasePct.toFixed(0)}% of rated on a ${info.ratingKva} kVA unit.`;

  const hash = computeEventHash(t.lastEventHash, {
    transformerId,
    type: "LOAD_CHECK_RECORDED",
    fromStatus: t.status,
    toStatus: "IN_FIELD",
    userId: actor.id,
    occurredAt,
    notes,
  });

  await prisma.$transaction(async (db) => {
    await db.lifecycleEvent.create({
      data: {
        transformerId,
        type: "LOAD_CHECK_RECORDED",
        fromStatus: t.status,
        toStatus: "IN_FIELD",
        userId: actor.id,
        occurredAt,
        notes,
        hash,
        hashVersion: CURRENT_HASH_VERSION,
        prevHash: t.lastEventHash,
      },
    });
    await db.transformer.update({ where: { id: transformerId }, data: { lastEventHash: hash } });
  });
}
