import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { MatchMethod } from "@/generated/prisma/enums";
import { prisma } from "./prisma";
import { parseCsv, parseXlsx } from "./import-parse";
import { parseEmdisBlocks, normaliseSerialForMatch, type EmdisBlock } from "./emdis-parse";
import { analyseReading, ratedPhaseCurrent, NOMINAL_VLL, LIMITS } from "./load-analysis";
import { computeEventHash } from "./chain";

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
  }[];
  totalReadings: number;
  rejected: number;
};

function intervalOf(rows: { recordedAt: Date }[]): number {
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

async function readFile(buffer: ArrayBuffer, fileName: string): Promise<EmdisBlock[]> {
  const grid = fileName.toLowerCase().endsWith(".csv")
    ? parseCsv(new TextDecoder().decode(buffer))
    : await parseXlsx(buffer);

  const blocks = parseEmdisBlocks(grid);
  if (!blocks.length) {
    throw new Error(
      "No EMDis blocks found. The export should begin with a line reading \"Transformer Substation: ...\" followed by a Timestamp header.",
    );
  }
  return blocks;
}

export async function previewEmdis(buffer: ArrayBuffer, fileName: string): Promise<EmdisPreview> {
  const blocks = await readFile(buffer, fileName);

  const out: EmdisPreview["blocks"] = [];
  for (const b of blocks) {
    const sorted = [...b.rows].sort((x, y) => x.recordedAt.getTime() - y.recordedAt.getTime());
    const m = await matchBlock(b);
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
    });
  }

  return {
    blocks: out,
    totalReadings: blocks.reduce((s, b) => s + b.rows.length, 0),
    rejected: blocks.reduce((s, b) => s + b.rejected, 0),
  };
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
  }[];
  totalReadings: number;
};

export async function commitEmdis(
  buffer: ArrayBuffer,
  fileName: string,
  actor: { id: string; name: string },
): Promise<EmdisCommitResult> {
  const blocks = await readFile(buffer, fileName);

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
  let imported = 0;

  for (const block of blocks) {
    const m = await matchBlock(block);
    const sorted = [...block.rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

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
      },
    });

    // --- Rows, with the analysis baked in ---------------------------------
    const rows: Prisma.EmdisReadingCreateManyInput[] = sorted.map((r) => {
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

    // --- Hourly rollup ------------------------------------------------------
    const buckets = new Map<number, typeof rows>();
    for (const row of rows) {
      const h = Math.floor(row.recordedAt instanceof Date ? row.recordedAt.getTime() / 3.6e6 : 0);
      const list = buckets.get(h) ?? [];
      list.push(row);
      buckets.set(h, list);
    }

    const minutesPer = intervalOf(sorted) / 60;
    const hourly: Prisma.EmdisHourlyCreateManyInput[] = [...buckets.entries()].map(([h, list]) => {
      const pick = (f: (r: (typeof rows)[0]) => number | null | undefined) =>
        list.map(f).filter((v): v is number => v != null && Number.isFinite(v));
      const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
      const max = (v: number[]) => (v.length ? Math.max(...v) : null);
      const min = (v: number[]) => (v.length ? Math.min(...v) : null);
      const p95 = (v: number[]) => {
        if (!v.length) return null;
        const s = [...v].sort((a, b) => a - b);
        return s[Math.floor(0.95 * (s.length - 1))];
      };
      const volts = list.flatMap((r) => [r.l1nV, r.l2nV, r.l3nV]).filter((v): v is number => v != null && v > 50);

      return {
        datasetId: dataset.id,
        transformerId: m.transformerId,
        hourStart: new Date(h * 3.6e6),
        samples: list.length,
        avgKva: avg(pick((r) => r.kva)), maxKva: max(pick((r) => r.kva)), p95Kva: p95(pick((r) => r.kva)),
        avgKw: avg(pick((r) => r.kw)), avgPf: avg(pick((r) => r.pf)),
        avgL1c: avg(pick((r) => r.l1c)), avgL2c: avg(pick((r) => r.l2c)), avgL3c: avg(pick((r) => r.l3c)),
        maxL1c: max(pick((r) => r.l1c)), maxL2c: max(pick((r) => r.l2c)), maxL3c: max(pick((r) => r.l3c)),
        avgNeutralC: avg(pick((r) => r.neutralC)), maxNeutralC: max(pick((r) => r.neutralC)),
        avgVoltage: avg(volts), minVoltage: min(volts), maxVoltage: max(volts),
        avgThdPct: avg(pick((r) => r.thdPct)), maxThdPct: max(pick((r) => r.thdPct)),
        avgUnbalancePct: avg(pick((r) => r.phaseUnbalancePct)), maxUnbalancePct: max(pick((r) => r.phaseUnbalancePct)),
        maxLoadingPct: max(pick((r) => r.loadingPct)),
        maxPhasePctRated: max(pick((r) => r.maxPhasePctRated)),
        minutesOver80Pct: Math.round(list.filter((r) => (r.maxPhaseC ?? 0) > iRated * LIMITS.phaseWarn).length * minutesPer),
        minutesOver100Pct: Math.round(list.filter((r) => (r.maxPhaseC ?? 0) > iRated).length * minutesPer),
      };
    });

    for (let i = 0; i < hourly.length; i += 500) {
      await prisma.emdisHourly.createMany({ data: hourly.slice(i, i + 500), skipDuplicates: true });
    }

    // --- Chain event and alerts, only for a matched transformer -------------
    let alertsRaised = 0;
    if (m.transformerId) {
      alertsRaised = await raiseLoadAlerts(m.transformerId, dataset.id, rows, iRated, ratingKva);
      await writeLoadCheckEvent(m.transformerId, actor.id, {
        fileName,
        readings: rows.length,
        from: sorted[0].recordedAt,
        to: sorted[sorted.length - 1].recordedAt,
        peakPhasePct: Math.max(...rows.map((r) => r.maxPhasePctRated ?? 0)),
        ratingKva,
      });
    }

    datasets.push({
      id: dataset.id,
      label: m.label,
      substationCode: block.header.substationCode,
      readings: rows.length,
      matched: Boolean(m.transformerId),
      alertsRaised,
    });
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      rowsImported: imported,
      rowsStaged: datasets.filter((d) => !d.matched).reduce((s, d) => s + d.readings, 0),
      notes: `${datasets.length} transformer block(s); ${datasets.filter((d) => d.matched).length} matched.`,
    },
  });

  return { batchId: batch.id, datasets, totalReadings: imported };
}

/**
 * Raise alerts from what the data actually shows.
 *
 * One alert per condition per upload, not one per reading — 149 minutes above
 * rated current is a single finding, and 149 identical alerts is a wall of
 * noise that guarantees the real one is ignored.
 */
async function raiseLoadAlerts(
  transformerId: string,
  datasetId: string,
  rows: Prisma.EmdisReadingCreateManyInput[],
  iRated: number,
  ratingKva: number,
): Promise<number> {
  const tx = await prisma.transformer.findUnique({
    where: { id: transformerId },
    select: { gNumber: true, serialNumber: true, region: true },
  });
  if (!tx) return 0;
  const label = tx.gNumber ?? tx.serialNumber;

  const over = rows.filter((r) => (r.maxPhasePctRated ?? 0) > 100);
  const unb = rows.map((r) => r.phaseUnbalancePct ?? 0).sort((a, b) => a - b);
  const medUnb = unb.length ? unb[Math.floor(unb.length / 2)] : 0;
  const neutrals = rows.map((r) => r.neutralPctRated ?? 0).sort((a, b) => a - b);
  const medNeutral = neutrals.length ? neutrals[Math.floor(neutrals.length / 2)] : 0;

  const alerts: Prisma.AlertCreateManyInput[] = [];

  if (over.length) {
    const peak = Math.max(...rows.map((r) => r.maxPhasePctRated ?? 0));
    const hidden = over.filter((r) => (r.loadingPct ?? 0) < 100).length;
    alerts.push({
      transformerId,
      type: "SINGLE_PHASE_OVERLOAD",
      severity: "CRITICAL",
      region: tx.region,
      message:
        `${label}: a phase reached ${peak.toFixed(0)}% of its ${iRated.toFixed(0)} A rating on a ${ratingKva} kVA unit, ` +
        `for ${over.length} minute(s).` +
        (hidden ? ` For ${hidden} of those the total kVA was still under nameplate — invisible to any kVA report.` : ""),
    });
  }

  if (medUnb >= LIMITS.unbalanceWarn) {
    alerts.push({
      transformerId,
      type: "PHASE_UNBALANCE",
      severity: medUnb >= LIMITS.unbalanceCritical ? "CRITICAL" : "WARNING",
      region: tx.region,
      message: `${label}: current unbalance ${medUnb.toFixed(0)}% for half the window. Rebalancing single-phase load is the cheapest fix available.`,
    });
  }

  if (medNeutral >= LIMITS.neutralWarn * 100) {
    alerts.push({
      transformerId,
      type: "NEUTRAL_CURRENT_HIGH",
      severity: medNeutral >= LIMITS.neutralCritical * 100 ? "CRITICAL" : "WARNING",
      region: tx.region,
      message: `${label}: neutral carrying ${medNeutral.toFixed(0)}% of rated phase current. A balanced load returns almost none.`,
    });
  }

  const thds = rows.map((r) => r.thdPct ?? 0).filter((t) => t > 0).sort((a, b) => a - b);
  const medThd = thds.length ? thds[Math.floor(thds.length / 2)] : 0;
  if (medThd > LIMITS.thdCritical) {
    alerts.push({
      transformerId,
      type: "THD_HIGH",
      severity: "WARNING",
      region: tx.region,
      message: `${label}: harmonic distortion ${medThd.toFixed(1)}% median, above the 8% IEEE 519 limit for low voltage.`,
    });
  }

  if (alerts.length) await prisma.alert.createMany({ data: alerts });
  void datasetId;
  return alerts.length;
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
        prevHash: t.lastEventHash,
      },
    });
    await db.transformer.update({ where: { id: transformerId }, data: { lastEventHash: hash } });
  });
}
