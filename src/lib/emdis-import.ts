import "./server-guard";
import type { Prisma } from "@/generated/prisma/client";
import type { MatchMethod } from "@/generated/prisma/enums";
import { prisma } from "./prisma";
import { parseCsv, parseXlsx } from "./import-parse";
import { parseEmdisBlocks, normaliseSerialForMatch, type EmdisBlock } from "./emdis-parse";
import { parseFlatTable, headerSignature } from "./flat-import";
import { mapColumns, detectFormat, type CanonField, type ColumnMapping, type FormatDetection } from "./universal-columns";
import { blockContentHash, identityKey, type CandidateRange, type ExistingRange } from "./emdis-fingerprint";
import { existingRanges, checkBlock, toReport, type DuplicateReport } from "./emdis-duplicates";
import { rollupHourly } from "./emdis-rollup";
import { analyseReading, ratedPhaseCurrent, NOMINAL_VLL, LIMITS } from "./load-analysis";
import { pickSnapshotRow, deriveSnapshot } from "./analysis-snapshot";
import { buildLoadAlerts } from "./load-alerts";
import { THERMAL_CONSTANT_SELECT } from "./thermal-constants";
import { ambientForMonth } from "./load-balancing";
import { computeEventHash, CURRENT_HASH_VERSION } from "./chain";
import { refreshCachedScores } from "./combined-health";
import { deriveHealthStatus } from "./health-status";

/**
 * Ingesting EMDis load telemetry.
 *
 * Three things happen that are worth naming:
 *
 *   The reading is analysed at ingest, not at query time. Per-phase percentage,
 *   unbalance and neutral ratio are stored on each row, because recomputing
 *   them across half a million rows every time a dashboard opens is not a
 *   design, it is a promise to be slow later.
 *
 *   Hourly rollups are built in the same pass. Raw data answers "what happened
 *   at 20:08"; everything else reads the rollup.
 *
 *   A LOAD_CHECK_RECORDED event goes on the transformer's chain. George asked
 *   to "upload this data as a load check", and a load check is something that
 *   happened to the asset — it belongs in its story, not in a side table.
 */

export type EmdisPreview = {
  /** How the file was read, so the confirm screen can lead with it. */
  layout: "emdis" | "flat-table";
  detection: FormatDetection;
  /** The column recognition, for the mapping table and the unmapped warning. */
  columnMapping: {
    columns: { index: number; header: string; mappedTo: CanonField | null }[];
    unmapped: string[];
    missing: CanonField[];
    mappedCount: number;
    totalColumns: number;
  };
  /** A saved profile whose header set matches this file, if one exists. */
  matchedProfile: { id: string; name: string } | null;
  blocks: {
    substationCode: string | null;
    serial: string | null;
    make: string | null;
    ratingKva: number | null;
    readings: number;
    firstReadingAt: string;
    lastReadingAt: string;
    intervalSeconds: number;
    spanHours: number;
    claimedTimeRange: string | null;
    match: {
      transformerId: string | null;
      label: string | null;
      method: MatchMethod;
      registerRatingKva: number | null;
      ratingMismatch: boolean;
    };
    /** What this block would do to data already in the register. */
    duplicate: DuplicateReport;
    /** Held back rather than imported, and why. Unmatched blocks are staged. */
    willStage: boolean;
    stagingReason: string | null;
  }[];
  totalReadings: number;
  rejected: number;
};

function intervalOf(rows: readonly { recordedAt: Date }[]): number {
  const gaps: number[] = [];
  const sorted = [...rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].recordedAt.getTime() - sorted[i - 1].recordedAt.getTime()) / 1000);
  }
  if (!gaps.length) return 60;
  gaps.sort((a, b) => a - b);
  return Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)]));
}

/**
 * Find the transformer this export describes.
 *
 * The EMDis header has no G-Number, so serial and substation code are all there
 * is. Substation is only trusted when exactly one transformer sits there — a
 * site can hold several, and attaching a load profile to the wrong unit would
 * be worse than attaching it to none.
 */
async function matchBlock(block: EmdisBlock) {
  const serial = normaliseSerialForMatch(block.header.serial);

  if (serial) {
    const all = await prisma.transformer.findMany({
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true },
    });
    const hit = all.find((t) => {
      const s = t.serialNumber.toUpperCase();
      return (/^\d+$/.test(s) ? s.replace(/^0+/, "") : s.replace(/\s+/g, "")) === serial;
    });
    if (hit) {
      return {
        transformerId: hit.id,
        label: hit.gNumber ?? hit.serialNumber,
        method: "SERIAL" as MatchMethod,
        registerRatingKva: hit.ratingKva,
      };
    }
  }

  if (block.header.substationCode) {
    const at = await prisma.transformer.findMany({
      where: { substationCode: block.header.substationCode },
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true },
    });
    if (at.length === 1) {
      return {
        transformerId: at[0].id,
        label: at[0].gNumber ?? at[0].serialNumber,
        method: "SUBSTATION_CODE" as MatchMethod,
        registerRatingKva: at[0].ratingKva,
      };
    }
  }

  return { transformerId: null, label: null, method: "UNRESOLVED" as MatchMethod, registerRatingKva: null };
}

/** The engineer picked this transformer explicitly in the confirm screen. */
async function matchChosen(transformerId: string) {
  const t = await prisma.transformer.findUnique({
    where: { id: transformerId },
    select: { id: true, gNumber: true, serialNumber: true, ratingKva: true },
  });
  if (!t) return { transformerId: null, label: null, method: "UNRESOLVED" as MatchMethod, registerRatingKva: null };
  return {
    transformerId: t.id,
    label: t.gNumber ?? t.serialNumber,
    method: "MANUAL" as MatchMethod,
    registerRatingKva: t.ratingKva,
  };
}

/** Persist the resolved mapping under a name, keyed on the header fingerprint. */
async function saveProfile(
  name: string,
  mapping: ColumnMapping,
  headerRow: string[],
  actor: { id: string; name: string },
) {
  const map: Record<string, CanonField> = {};
  for (const c of mapping.columns) if (c.mappedTo) map[c.header] = c.mappedTo;
  const sig = headerSignature(headerRow);
  await prisma.columnMappingProfile.upsert({
    where: { name },
    create: {
      name, mapping: map, headerSignature: sig,
      createdById: actor.id, createdByName: actor.name, timesUsed: 1,
    },
    update: { mapping: map, headerSignature: sig, lastUsedAt: new Date(), timesUsed: { increment: 1 } },
  });
}

/** A file matched a saved profile — record that it was used again. */
async function touchProfile(headerRow: string[]) {
  const sig = headerSignature(headerRow);
  if (!sig) return;
  await prisma.columnMappingProfile.updateMany({
    where: { headerSignature: sig },
    data: { lastUsedAt: new Date(), timesUsed: { increment: 1 } },
  });
}

async function readGrid(buffer: ArrayBuffer, fileName: string): Promise<string[][]> {
  return fileName.toLowerCase().endsWith(".csv")
    ? parseCsv(new TextDecoder().decode(buffer))
    : await parseXlsx(buffer);
}

/** The header row a layout uses, for building the mapping display. */
function headerRowOf(grid: string[][], layout: "emdis" | "flat-table"): string[] {
  if (layout === "emdis") return grid.find((r) => /^timestamp$/i.test((r[0] ?? "").trim())) ?? [];
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    if (Object.keys(mapColumns(grid[i]).fieldToIndex).length >= 2) return grid[i];
  }
  return [];
}

type UniversalRead = {
  layout: "emdis" | "flat-table";
  blocks: EmdisBlock[];
  detection: FormatDetection;
  mapping: ColumnMapping;
  headerRow: string[];
};

/**
 * Read any supported file into blocks, and say how it was read.
 *
 * The EMDis report and a plain flat table both end up as `EmdisBlock[]`, so
 * everything downstream — analysis, rollups, alerts — is written once. The
 * difference between the two lives only here.
 */
async function readUniversal(
  buffer: ArrayBuffer,
  fileName: string,
  mappingOverride?: Record<string, CanonField>,
): Promise<UniversalRead> {
  const grid = await readGrid(buffer, fileName);
  const detection = detectFormat(grid);

  if (detection.layout === "emdis") {
    const blocks = parseEmdisBlocks(grid);
    if (!blocks.length) {
      throw new Error(
        "This looked like an EMDis report but no readings were found under its header.",
      );
    }
    const headerRow = headerRowOf(grid, "emdis");
    return { layout: "emdis", blocks, detection, mapping: mapColumns(headerRow), headerRow };
  }

  // Flat table (or an unrecognised layout we still try to read as a table).
  const flat = parseFlatTable(grid, mappingOverride);
  if (!flat || !flat.block.rows.length) {
    throw new Error(
      "No readings could be read. The file needs a header row naming at least a timestamp and one " +
        "current or voltage column, with the readings beneath it. Nothing recognisable was found.",
    );
  }
  return {
    layout: "flat-table",
    blocks: [flat.block],
    detection: flat.detection,
    mapping: flat.mapping,
    headerRow: headerRowOf(grid, "flat-table"),
  };
}

/**
 * The comparison key for a block, ready for the duplicate check.
 *
 * `sorted` is passed in rather than re-sorted, because both callers have
 * already paid for that sort and a file of half a million rows should not be
 * sorted three times to answer one question about its first and last row.
 */
function candidateOf(
  block: EmdisBlock,
  sorted: readonly { recordedAt: Date }[],
  transformerId: string | null,
): CandidateRange {
  return {
    contentHash: blockContentHash(block.header.substationCode, block.header.serial, block.rows),
    transformerId,
    identity: identityKey(block.header.substationCode, block.header.serial),
    firstReadingAt: sorted[0].recordedAt,
    lastReadingAt: sorted[sorted.length - 1].recordedAt,
    readingCount: sorted.length,
  };
}

/**
 * Why this block is being held back from the analysis, or null to import it.
 *
 * Only one reason today: nothing on the register matches it. Written as a
 * function returning the sentence rather than a boolean, because the sentence
 * is what the manager reviewing the staging queue actually needs — "unmatched"
 * on its own tells them nothing about what to search for.
 */
function stagingReasonFor(block: EmdisBlock, transformerId: string | null): string | null {
  if (transformerId) return null;
  const bits: string[] = [];
  if (block.header.serial) bits.push(`serial ${block.header.serial}`);
  if (block.header.substationCode) bits.push(`substation ${block.header.substationCode}`);
  return (
    "No transformer on the register matches this data" +
    (bits.length ? ` (${bits.join(", ")})` : "") +
    ". Held in staging rather than imported unattached, so its readings cannot " +
    "be counted toward any transformer until someone says which one."
  );
}

export async function previewEmdis(
  buffer: ArrayBuffer,
  fileName: string,
  mappingOverride?: Record<string, CanonField>,
): Promise<EmdisPreview> {
  const { layout, blocks, detection, mapping, headerRow } = await readUniversal(
    buffer, fileName, mappingOverride,
  );

  // Fetched once for the whole file rather than per block. An EMDis export can
  // carry dozens of transformer blocks, and re-reading every stored range for
  // each of them would turn one query into dozens for no new information.
  const known = await existingRanges();

  const out: EmdisPreview["blocks"] = [];
  for (const b of blocks) {
    const sorted = [...b.rows].sort((x, y) => x.recordedAt.getTime() - y.recordedAt.getTime());
    const m = await matchBlock(b);
    const candidate = candidateOf(b, sorted, m.transformerId);
    const check = checkBlock(candidate, known);
    const stage = stagingReasonFor(b, m.transformerId);

    out.push({
      substationCode: b.header.substationCode,
      serial: b.header.serial,
      make: b.header.make,
      ratingKva: b.header.ratingKva,
      readings: b.rows.length,
      firstReadingAt: sorted[0].recordedAt.toISOString(),
      lastReadingAt: sorted[sorted.length - 1].recordedAt.toISOString(),
      intervalSeconds: intervalOf(b.rows),
      spanHours:
        (sorted[sorted.length - 1].recordedAt.getTime() - sorted[0].recordedAt.getTime()) / 3.6e6,
      claimedTimeRange: b.header.timeRange,
      match: {
        ...m,
        // A rating disagreement is not cosmetic: it changes rated current, so
        // every overload judgement in this file would shift with it.
        ratingMismatch:
          m.registerRatingKva != null &&
          b.header.ratingKva != null &&
          m.registerRatingKva !== b.header.ratingKva,
      },
      duplicate: toReport(check),
      willStage: stage != null,
      stagingReason: stage,
    });

    // A block is compared against the ones before it in the SAME file too. A
    // single export that repeats one transformer twice is a duplicate that no
    // amount of checking against the database would ever catch.
    known.push({ ...candidate, id: `pending:${known.length}`, name: fileName, createdAt: new Date() });
  }

  const matchedProfile = await findMatchingProfile(headerRow);

  return {
    layout,
    detection,
    columnMapping: {
      columns: mapping.columns,
      unmapped: mapping.unmapped,
      missing: mapping.missing,
      mappedCount: Object.keys(mapping.fieldToIndex).length,
      totalColumns: mapping.columns.length,
    },
    matchedProfile,
    blocks: out,
    totalReadings: blocks.reduce((s, b) => s + b.rows.length, 0),
    rejected: blocks.reduce((s, b) => s + b.rejected, 0),
  };
}

/** A saved profile whose header fingerprint matches this file, if any. */
async function findMatchingProfile(headerRow: string[]): Promise<{ id: string; name: string } | null> {
  if (!headerRow.length) return null;
  const sig = headerSignature(headerRow);
  if (!sig) return null;
  const hit = await prisma.columnMappingProfile.findFirst({
    where: { headerSignature: sig },
    select: { id: true, name: true },
    orderBy: { lastUsedAt: "desc" },
  });
  return hit;
}

export type EmdisCommitResult = {
  batchId: string;
  datasets: {
    id: string;
    label: string | null;
    substationCode: string | null;
    readings: number;
    matched: boolean;
    alertsRaised: number;
    /** Stored but held out of the analysis until a human names its transformer. */
    staged: boolean;
  }[];
  /**
   * Blocks that were refused, and why. Present in the result rather than thrown,
   * because a five-block export with one duplicate block should import the other
   * four — failing the whole file would teach people to force everything.
   */
  skipped: {
    label: string | null;
    substationCode: string | null;
    readings: number;
    verdict: string;
    reason: string;
    /** Whether the uploader could have imported it anyway by confirming. */
    overridable: boolean;
  }[];
  totalReadings: number;
  /** Auto-status: for every transformer this upload touched, its health after rescoring. */
  healthUpdates: {
    transformerId: string;
    label: string;
    level: string;
    explanation: string;
    alertsRaised: number;
  }[];
};

export type CommitOptions = {
  /** For a flat table with no automatic match: the transformer the engineer
   *  chose in the confirm screen. Applies to the single block a flat file has. */
  transformerId?: string | null;
  /** Header -> field corrections from the confirm screen or a saved profile. */
  mappingOverride?: Record<string, CanonField>;
  /** If set, save the resolved mapping under this name for next time. */
  saveProfileName?: string | null;
  /**
   * The uploader saw the overlap warning and chose to import anyway.
   *
   * Unlocks SAME_RANGE and OVERLAP only. It does not unlock IDENTICAL, and no
   * option does: re-importing byte-identical readings cannot make the register
   * more accurate, and every path that could do it is a path by which the
   * time-over-rated totals silently double.
   */
  force?: boolean;
};

export async function commitEmdis(
  buffer: ArrayBuffer,
  fileName: string,
  actor: { id: string; name: string },
  options: CommitOptions = {},
): Promise<EmdisCommitResult> {
  const { layout, blocks, mapping, headerRow } = await readUniversal(
    buffer, fileName, options.mappingOverride,
  );

  // Save or refresh the mapping profile, so the next identical file is instant.
  if (options.saveProfileName?.trim()) {
    await saveProfile(options.saveProfileName.trim(), mapping, headerRow, actor);
  } else if (headerRow.length) {
    await touchProfile(headerRow);
  }

  const batch = await prisma.importBatch.create({
    data: {
      kind: "EMDIS",
      fileName,
      uploadedById: actor.id,
      uploadedByName: actor.name,
      rowsTotal: blocks.reduce((s, b) => s + b.rows.length, 0),
    },
  });

  const datasets: EmdisCommitResult["datasets"] = [];
  const skipped: EmdisCommitResult["skipped"] = [];
  let imported = 0;
  // Auto-status: every transformer this file actually touched, and how many
  // alerts each one raised — rescored once after the loop, not per block.
  const alertsByTransformer = new Map<string, { label: string; alerts: number }>();

  // The duplicate comparison set, read once and then kept current in memory as
  // blocks are written. Re-querying per block would be slower AND wrong: the
  // block just written in this same loop has to be visible to the next one.
  const known: ExistingRange[] = await existingRanges();

  for (const block of blocks) {
    let m = await matchBlock(block);
    // A flat file with one block and an engineer-chosen transformer overrides
    // the automatic match — this is the "Select from register" path in the
    // confirm screen, and the engineer's choice is authoritative.
    if (layout === "flat-table" && blocks.length === 1 && options.transformerId) {
      m = await matchChosen(options.transformerId);
    }
    const sorted = [...block.rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

    // Duplicate check before anything is written. Nothing about this block
    // reaches the database until it has been established that the register does
    // not already hold it.
    const candidate = candidateOf(block, sorted, m.transformerId);
    const check = checkBlock(candidate, known);
    const refuse = check.blocked && !(check.overridable && options.force === true);
    if (refuse) {
      skipped.push({
        label: m.label,
        substationCode: block.header.substationCode,
        readings: sorted.length,
        verdict: check.verdict,
        reason: check.findings[0]?.reason ?? "Already present in the register.",
        overridable: check.overridable,
      });
      continue;
    }

    // Unmatched data is staged, not imported. It is stored in full — nothing is
    // lost — but it stays out of every query that produces a number until a
    // human names its transformer. See stagingReasonFor().
    const stagingReason = stagingReasonFor(block, m.transformerId);
    const staged = stagingReason != null;

    // The register's rating wins when we have one. It is the value a human has
    // taken responsibility for; the file header is whatever the meter was told.
    const ratingKva = m.registerRatingKva ?? block.header.ratingKva ?? 200;
    const voltLL = NOMINAL_VLL;
    const iRated = ratedPhaseCurrent(ratingKva, voltLL);

    const dataset = await prisma.emdisDataset.create({
      data: {
        name: fileName,
        transformerId: m.transformerId,
        resolvedBy: m.method,
        substationCode: block.header.substationCode,
        serialAsRecorded: block.header.serial,
        makeAsRecorded: block.header.make,
        ratingKvaAsRecorded: block.header.ratingKva,
        nominalVoltLL: voltLL,
        firstReadingAt: sorted[0].recordedAt,
        lastReadingAt: sorted[sorted.length - 1].recordedAt,
        readingCount: sorted.length,
        intervalSeconds: intervalOf(sorted),
        uploadedById: actor.id,
        uploadedByName: actor.name,
        importBatchId: batch.id,
        contentHash: candidate.contentHash,
        staged,
        stagingReason,
      },
    });

    known.push({ ...candidate, id: dataset.id, name: fileName, createdAt: dataset.createdAt });

    // `recordedAt` is narrowed to Date — Prisma's input type also allows an ISO
    // string, and the rollup needs to do date arithmetic on it. Narrowing here
    // costs nothing; mapping half a million rows into a second shape later to
    // satisfy the same constraint would cost a copy of the whole file.
    const rows: (Prisma.EmdisReadingCreateManyInput & { recordedAt: Date })[] = sorted.map((r) => {
      const a = analyseReading(r, ratingKva, voltLL);
      return {
        datasetId: dataset.id,
        recordedAt: r.recordedAt,
        l1nV: r.l1nV, l2nV: r.l2nV, l3nV: r.l3nV,
        l1c: r.l1c, l2c: r.l2c, l3c: r.l3c,
        neutralC: r.neutralC,
        l1l2V: r.l1l2V, l2l3V: r.l2l3V, l3l1V: r.l3l1V,
        kva: r.kva, kw: r.kw, kvar: r.kvar,
        pf: r.pf, hz: r.hz, thdPct: r.thdPct, kwh: r.kwh,
        maxPhaseC: a.maxPhaseC,
        phaseUnbalancePct: a.unbalancePct,
        loadingPct: a.loadingPct,
        maxPhasePctRated: a.maxPhasePctRated,
        neutralPctRated: a.neutralPctRated,
      };
    });

    const CHUNK = 5000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await prisma.emdisReading.createMany({ data: rows.slice(i, i + CHUNK) });
    }
    imported += rows.length;

    // Hourly rollup, from the shared builder. Not an optimisation — a thousand
    // transformers at one-minute resolution is 525 million rows a year, and the
    // rollup is the only shape in which most of the questions can be answered.
    const hourly = rollupHourly(rows, {
      datasetId: dataset.id,
      transformerId: m.transformerId,
      intervalSeconds: intervalOf(sorted),
      iRated,
    });

    for (let i = 0; i < hourly.length; i += 500) {
      await prisma.emdisHourly.createMany({ data: hourly.slice(i, i + 500), skipDuplicates: true });
    }

    let alertsRaised = 0;
    // Staged data raises nothing and writes nothing to the chain. An alert
    // names a transformer, and a staged block is precisely the case where we do
    // not know which transformer to name. Both happen on approval instead.
    const matchedTransformerId = staged ? null : m.transformerId;
    if (matchedTransformerId) {
      alertsRaised = await raiseLoadAlerts(matchedTransformerId, dataset.id, rows, iRated, ratingKva);
      await writeLoadCheckEvent(matchedTransformerId, actor.id, {
        fileName,
        readings: rows.length,
        from: sorted[0].recordedAt,
        to: sorted[sorted.length - 1].recordedAt,
        peakPhasePct: Math.max(...rows.map((r) => r.maxPhasePctRated ?? 0)),
        ratingKva,
      });
      const acc = alertsByTransformer.get(matchedTransformerId) ?? { label: m.label ?? matchedTransformerId, alerts: 0 };
      acc.alerts += alertsRaised;
      alertsByTransformer.set(matchedTransformerId, acc);
    }

    datasets.push({
      id: dataset.id,
      label: m.label,
      substationCode: block.header.substationCode,
      readings: rows.length,
      matched: Boolean(m.transformerId),
      alertsRaised,
      staged,
    });
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      rowsImported: imported,
      rowsStaged: datasets.filter((d) => d.staged).reduce((s, d) => s + d.readings, 0),
      rowsRejected: skipped.reduce((s, d) => s + d.readings, 0),
      notes:
        `${datasets.length} transformer block(s); ${datasets.filter((d) => d.matched).length} matched, ` +
        `${datasets.filter((d) => d.staged).length} staged` +
        (skipped.length ? `, ${skipped.length} refused as duplicate.` : "."),
    },
  });

  const healthUpdates: EmdisCommitResult["healthUpdates"] = [];
  if (alertsByTransformer.size) {
    const scored = await refreshCachedScores({ transformerIds: [...alertsByTransformer.keys()] });
    for (const row of scored) {
      const acc = alertsByTransformer.get(row.id);
      if (!acc) continue;
      const { level, explanation } = deriveHealthStatus({
        electrical: row.electrical, physical: row.physical, status: row.status, reasons: row.reasons,
      });
      healthUpdates.push({ transformerId: row.id, label: acc.label, level, explanation, alertsRaised: acc.alerts });
    }
  }

  return { batchId: batch.id, datasets, skipped, totalReadings: imported, healthUpdates };
}

/**
 * Raise alerts from what the data actually shows.
 *
 * One alert per condition per upload, not one per reading — 149 minutes above
 * rated current is a single finding, and 149 identical alerts is a wall of
 * noise that guarantees the real one is ignored.
 *
 * This function no longer decides anything. It gathers: the snapshot reading,
 * the transformer's certificate constants, and the duration facts that a single
 * instant cannot carry. buildLoadAlerts() in load-alerts.ts writes the messages,
 * from the STORED derived snapshot and nothing else.
 *
 * That split is the point. The alert generator used to take its own median
 * across the upload while the API returned the peak-load reading, so an alert
 * could say 63% while the screen it linked to said 42.72% about the same
 * transformer on the same minute. There is now one derivation, in one file,
 * with tests on it.
 */
export async function raiseLoadAlerts(
  transformerId: string,
  datasetId: string,
  rows: readonly (Prisma.EmdisReadingCreateManyInput & { recordedAt: Date })[],
  iRated: number,
  ratingKva: number,
  /**
   * Restrict which alert types may be created. The recompute backfill replaces
   * only the two snapshot-derived types, and must not duplicate the overload or
   * THD alerts already sitting in the table.
   */
  only?: readonly Prisma.AlertCreateManyInput["type"][],
): Promise<number> {
  const tx = await prisma.transformer.findUnique({
    where: { id: transformerId },
    select: {
      gNumber: true, serialNumber: true, region: true, secondaryKv: true,
      ...THERMAL_CONSTANT_SELECT,
    },
  });
  if (!tx) return 0;
  const label = tx.gNumber ?? tx.serialNumber;

  // The snapshot reading: the same row, and the same derivation, that the API
  // field and the health record use.
  const picked = pickSnapshotRow(rows);
  if (!picked) return 0;

  const secondaryV = tx.secondaryKv ? tx.secondaryKv * 1000 : null;
  const voltLL = secondaryV && secondaryV > 100 ? secondaryV : NOMINAL_VLL;

  const snapshot = deriveSnapshot({
    row: picked.row,
    index: picked.index,
    selectedBecause: picked.reason,
    ratingKva,
    voltLL,
    ambientC: ambientForMonth(picked.row.recordedAt.getUTCMonth()),
    transformer: tx,
  });

  // Durations. Counts of readings, not levels — deliberately separated, because
  // "149 minutes above rated" cannot be read off a single instant and must not
  // look as though it was.
  const minutesPer = intervalOf(rows) / 60;
  const over = rows.filter((r) => (r.maxPhasePctRated ?? 0) > 100);
  let longestRun = 0;
  let run = 0;
  for (const r of rows) {
    if ((r.maxPhasePctRated ?? 0) > 100) { run++; longestRun = Math.max(longestRun, run); }
    else run = 0;
  }

  const alerts = buildLoadAlerts({
    transformerId,
    label,
    region: tx.region,
    snapshot,
    window: {
      minutesAnyPhaseOverRated: Math.round(over.length * minutesPer),
      hiddenOverloadMinutes: Math.round(
        over.filter((r) => (r.loadingPct ?? 0) < 100).length * minutesPer,
      ),
      longestExcursionMinutes: Math.round(longestRun * minutesPer),
      minutesUnbalanceOver10: Math.round(
        rows.filter((r) => (r.phaseUnbalancePct ?? 0) >= LIMITS.unbalanceWarn).length * minutesPer,
      ),
      minutesThdOverLimit: Math.round(
        rows.filter((r) => (r.thdPct ?? 0) > LIMITS.thdCritical).length * minutesPer,
      ),
    },
  });

  const toCreate = (only ? alerts.filter((a) => only.includes(a.type)) : alerts)
    // Tied to the readings they were read off. When that dataset is deleted —
    // as a duplicate, or because it was wrong — the alert goes with it, instead
    // of surviving as a warning about evidence that no longer exists.
    .map((a) => ({ ...a, datasetId }));
  if (toCreate.length) await prisma.alert.createMany({ data: toCreate });
  void iRated;
  return toCreate.length;
}

/** A load check is something that happened to the transformer. It goes on the chain. */
async function writeLoadCheckEvent(
  transformerId: string,
  userId: string,
  info: { fileName: string; readings: number; from: Date; to: Date; peakPhasePct: number; ratingKva: number },
) {
  const t = await prisma.transformer.findUnique({
    where: { id: transformerId },
    select: { lastEventHash: true, status: true },
  });
  if (!t) return;

  const occurredAt = info.to;
  const notes =
    `Load check from EMDis export ${info.fileName}. ` +
    `${info.readings} readings, ${info.from.toISOString().slice(0, 16).replace("T", " ")} to ${info.to.toISOString().slice(0, 16).replace("T", " ")} UTC. ` +
    `Peak phase current reached ${info.peakPhasePct.toFixed(0)}% of rated on a ${info.ratingKva} kVA unit.`;

  const hash = computeEventHash(t.lastEventHash, {
    transformerId,
    type: "LOAD_CHECK_RECORDED",
    fromStatus: t.status,
    toStatus: "IN_FIELD",
    userId,
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
        userId,
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
