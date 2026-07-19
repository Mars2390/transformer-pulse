import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { MatchMethod } from "@/generated/prisma/enums";
import { prisma } from "./prisma";
import { parseCsv, parseXlsx } from "./import-parse";
import {
  mapInspectionHeaders,
  parseInspectionRow,
  type ParsedInspection,
} from "./inspection-parse";

/**
 * Turning KPLC's inspection register into records the system can reason about.
 *
 * The hard part is not parsing — it is deciding what to do when a row does not
 * cleanly belong to a transformer we know about. There are three honest
 * outcomes and the importer uses all three:
 *
 *   MATCHED  the row attaches to a transformer on the register
 *   STAGED   the row is real and imported, but no transformer claims it yet
 *   REJECTED the row could not be read at all
 *
 * What the importer will NOT do is create transformers. The register has 66%
 * serial coverage and G-Numbers reading "Defaced"; auto-creating from it would
 * manufacture duplicates against KPLC's real asset list. Staged rows wait for a
 * human, who can attach them to an existing unit or promote them through the
 * onboarding flow that writes a proper genesis event.
 */

export type ResolveResult = {
  transformerId: string | null;
  matchedBy: MatchMethod;
};

/**
 * The resolution ladder, strongest key first.
 *
 * G-Number is primary: 88% of rows carry one and it is KPLC's own asset number.
 * Serial is the fallback, zero-normalised so the EMDis spelling and the form
 * spelling of the same number collide as they should. Substation code is last
 * because it identifies a SITE, and a site can hold more than one transformer —
 * so it is only trusted when exactly one unit sits there.
 */
export async function resolveTransformer(
  row: ParsedInspection,
  lookup: {
    byGNumber: Map<string, string>;
    bySerial: Map<string, string>;
    bySubstation: Map<string, string[]>;
  },
): Promise<ResolveResult> {
  if (row.gNumberForMatch) {
    const id = lookup.byGNumber.get(row.gNumberForMatch);
    if (id) return { transformerId: id, matchedBy: "G_NUMBER" };
  }
  if (row.serialForMatch) {
    const id = lookup.bySerial.get(row.serialForMatch);
    if (id) return { transformerId: id, matchedBy: "SERIAL" };
  }
  if (row.substationCode) {
    const ids = lookup.bySubstation.get(row.substationCode);
    // Exactly one, or not at all. Two transformers at one substation and we
    // cannot say which was inspected, so guessing would attach a pole condition
    // to the wrong asset.
    if (ids && ids.length === 1) return { transformerId: ids[0], matchedBy: "SUBSTATION_CODE" };
  }
  return { transformerId: null, matchedBy: "UNRESOLVED" };
}

/** Everything needed to resolve rows, loaded once instead of per row. */
export async function buildLookup() {
  const all = await prisma.transformer.findMany({
    select: { id: true, gNumber: true, serialNumber: true, substationCode: true },
  });

  const byGNumber = new Map<string, string>();
  const bySerial = new Map<string, string>();
  const bySubstation = new Map<string, string[]>();

  for (const t of all) {
    if (t.gNumber) byGNumber.set(t.gNumber.replace(/^G[\s-]?/i, ""), t.id);
    if (t.serialNumber) {
      const s = t.serialNumber.toUpperCase();
      bySerial.set(/^\d+$/.test(s) ? s.replace(/^0+/, "") : s.replace(/\s+/g, ""), t.id);
    }
    if (t.substationCode) {
      const list = bySubstation.get(t.substationCode) ?? [];
      list.push(t.id);
      bySubstation.set(t.substationCode, list);
    }
  }
  return { byGNumber, bySerial, bySubstation };
}

// --- Reading the file -------------------------------------------------------

export type PreviewRow = {
  reportId: number;
  inspectedOn: string;
  substation: string;
  gNumber: string | null;
  serial: string | null;
  structure: string | null;
  loading: string;
  earthFlag: string | null;
  outcome: "MATCHED" | "STAGED" | "REJECTED" | "DUPLICATE";
  matchedBy: MatchMethod;
  transformerLabel: string | null;
  reviewReasons: string[];
};

export type PreviewResult = {
  rows: PreviewRow[];
  totals: {
    total: number;
    matched: number;
    staged: number;
    rejected: number;
    duplicate: number;
    flagged: number;
  };
  headline: {
    rottenOrLeaning: number;
    fuseCarriersNeedReplacement: number;
    openEarths: number;
    loadingNotOkay: number;
    earthsOverTenOhm: number;
  };
  unmappedColumns: string[];
};

export async function readInspectionFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<{ parsed: ParsedInspection[]; rejected: { reason: string }[]; unmapped: string[] }> {
  const lower = fileName.toLowerCase();
  const grid = lower.endsWith(".csv")
    ? parseCsv(new TextDecoder().decode(buffer))
    : await parseXlsx(buffer);

  if (grid.length < 2) throw new Error("The file has no data rows.");

  const headers = mapInspectionHeaders(grid[0]);
  if (!("reportId" in headers) || !("inspectionDate" in headers)) {
    throw new Error(
      "This does not look like an inspection register — no Report ID or Inspection Date column was found.",
    );
  }

  const mappedIdx = new Set(Object.values(headers));
  const unmapped = grid[0]
    .map((h, i) => (h.trim() && !mappedIdx.has(i) ? h.trim() : null))
    .filter((x): x is string => x != null);

  const parsed: ParsedInspection[] = [];
  const rejected: { reason: string }[] = [];

  for (const cells of grid.slice(1)) {
    if (cells.every((c) => !c || !c.trim())) continue; // blank line
    const r = parseInspectionRow(cells, headers);
    if (r.ok) parsed.push(r.row);
    else rejected.push({ reason: r.reason });
  }

  return { parsed, rejected, unmapped };
}

/** KPLC practice: a distribution earth electrode should be at or under 10 ohms. */
export const EARTH_LIMIT_OHM = 10;

export async function previewInspections(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<PreviewResult> {
  const { parsed, rejected, unmapped } = await readInspectionFile(buffer, fileName);
  const lookup = await buildLookup();

  // Which report IDs are already in? Re-uploading a file must be a no-op.
  const existing = new Set(
    (
      await prisma.substationInspection.findMany({
        where: { reportId: { in: parsed.map((p) => p.reportId) } },
        select: { reportId: true },
      })
    ).map((r) => r.reportId),
  );

  const labels = new Map<string, string>();
  const ids = new Set<string>();

  const resolved = await Promise.all(
    parsed.map(async (row) => ({ row, res: await resolveTransformer(row, lookup) })),
  );
  for (const { res } of resolved) if (res.transformerId) ids.add(res.transformerId);
  if (ids.size) {
    for (const t of await prisma.transformer.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, gNumber: true, serialNumber: true },
    })) {
      labels.set(t.id, t.gNumber ?? t.serialNumber);
    }
  }

  const rows: PreviewRow[] = resolved.map(({ row, res }) => {
    const duplicate = existing.has(row.reportId);
    const earthFlag =
      row.hvEarth.state === "OPEN_CIRCUIT" || row.neutralEarth.state === "OPEN_CIRCUIT"
        ? "OPEN"
        : row.hvEarth.state === "VANDALISED" || row.neutralEarth.state === "VANDALISED"
          ? "VANDALISED"
          : (row.hvEarth.ohms ?? 0) > EARTH_LIMIT_OHM
            ? "HIGH"
            : null;

    return {
      reportId: row.reportId,
      inspectedOn: row.inspectedOn.toISOString().slice(0, 10),
      substation: [row.substationCode, row.substationName].filter(Boolean).join(" — "),
      gNumber: row.gNumberForMatch,
      serial: row.serialAsRecorded,
      structure: row.structure,
      loading: row.loadingOk === false ? `NOT OK${row.loadAction ? ` · ${row.loadAction}` : ""}` : row.loadingOk === true ? "OK" : "—",
      earthFlag,
      outcome: duplicate ? "DUPLICATE" : res.transformerId ? "MATCHED" : "STAGED",
      matchedBy: res.matchedBy,
      transformerLabel: res.transformerId ? (labels.get(res.transformerId) ?? null) : null,
      reviewReasons: row.reviewReasons,
    };
  });

  const fresh = rows.filter((r) => r.outcome !== "DUPLICATE");

  return {
    rows,
    totals: {
      total: parsed.length + rejected.length,
      matched: fresh.filter((r) => r.outcome === "MATCHED").length,
      staged: fresh.filter((r) => r.outcome === "STAGED").length,
      rejected: rejected.length,
      duplicate: rows.filter((r) => r.outcome === "DUPLICATE").length,
      flagged: fresh.filter((r) => r.reviewReasons.length > 0).length,
    },
    headline: {
      rottenOrLeaning: parsed.filter((p) => p.structure === "ROTTEN" || p.structure === "LEANING").length,
      fuseCarriersNeedReplacement: parsed.filter((p) => p.fuseCarriers === "NEEDS_REPLACEMENT").length,
      openEarths: parsed.filter(
        (p) => p.hvEarth.state === "OPEN_CIRCUIT" || p.neutralEarth.state === "OPEN_CIRCUIT",
      ).length,
      loadingNotOkay: parsed.filter((p) => p.loadingOk === false).length,
      earthsOverTenOhm: parsed.filter((p) => (p.hvEarth.ohms ?? 0) > EARTH_LIMIT_OHM).length,
    },
    unmappedColumns: unmapped,
  };
}

// --- Committing -------------------------------------------------------------

export type CommitResult = {
  batchId: string;
  imported: number;
  staged: number;
  duplicate: number;
  rejected: number;
  flagged: number;
  conflictsRaised: number;
  transformersTouched: number;
};

/**
 * Write the register.
 *
 * Two rules govern what happens to the transformers themselves:
 *
 *   Condition IS written back. Pole state and inspection date are observations
 *   of the world with a clear timestamp — the newest one wins, and it is what
 *   the map and the repair list read.
 *
 *   Identity is NOT. Make, rating and year as claimed on the form stay on the
 *   inspection row. Where they disagree with the register, a RecordConflict is
 *   raised and a human settles it. Letting each upload overwrite the nameplate
 *   would reproduce the exact failure this system exists to end: the last
 *   person to file wins, and the disagreement disappears.
 */
export async function commitInspections(
  buffer: ArrayBuffer,
  fileName: string,
  actor: { id: string; name: string },
): Promise<CommitResult> {
  const { parsed, rejected } = await readInspectionFile(buffer, fileName);
  const lookup = await buildLookup();

  const existing = new Set(
    (
      await prisma.substationInspection.findMany({
        where: { reportId: { in: parsed.map((p) => p.reportId) } },
        select: { reportId: true },
      })
    ).map((r) => r.reportId),
  );

  const batch = await prisma.importBatch.create({
    data: {
      kind: "INSPECTION",
      fileName,
      uploadedById: actor.id,
      uploadedByName: actor.name,
      rowsTotal: parsed.length + rejected.length,
    },
  });

  // Resolve everything up front so the write loop does no lookups.
  const work = await Promise.all(
    parsed
      .filter((p) => !existing.has(p.reportId))
      .map(async (row) => ({ row, res: await resolveTransformer(row, lookup) })),
  );

  const rowsData: Prisma.SubstationInspectionCreateManyInput[] = work.map(({ row, res }) => ({
    reportId: row.reportId,
    inspectedOn: row.inspectedOn,
    transformerId: res.transformerId,
    matchedBy: res.matchedBy,
    substationCode: row.substationCode,
    substationName: row.substationName,
    region: row.region,
    county: row.county,
    inspectorRef: row.inspectorRef,
    serialAsRecorded: row.serialAsRecorded,
    gNumberAsRecorded: row.gNumberAsRecorded,
    makeAsRecorded: row.makeAsRecorded,
    ratingKvaAsRecorded: row.ratingKvaAsRecorded,
    yomAsRecorded: row.yomAsRecorded,
    voltageKv: row.voltageKv,
    fuseSizeA: row.fuseSizeA,
    circuits: row.circuits,
    fuseCarriers: row.fuseCarriers,
    fuseBarType: row.fuseBarType,
    hvEarthOhm: row.hvEarth.ohms,
    hvEarthState: row.hvEarth.state,
    neutralEarthOhm: row.neutralEarth.ohms,
    neutralEarthState: row.neutralEarth.state,
    surgeArresterOhm: row.surgeArrester.ohms,
    surgeArresterState: row.surgeArrester.state,
    gapsetMm: row.gapsetMm,
    lvConductorMm2: row.lvConductorMm2,
    leadSizeMm2: row.leadSizeMm2,
    loadingOk: row.loadingOk,
    loadAction: row.loadAction,
    structure: row.structure,
    locationNote: row.locationNote,
    sourceFile: fileName,
    importBatchId: batch.id,
    rawRow: row.rawRow,
    needsReview: row.needsReview,
    reviewReasons: row.reviewReasons,
  }));

  // Chunked: a full register is 1,500+ rows and one statement per row against a
  // remote database is the difference between seconds and minutes.
  const CHUNK = 500;
  for (let i = 0; i < rowsData.length; i += CHUNK) {
    await prisma.substationInspection.createMany({ data: rowsData.slice(i, i + CHUNK) });
  }

  // --- Roll condition forward onto the transformers -------------------------
  // Only the newest inspection per transformer matters for cached state.
  const newestPerTransformer = new Map<string, ParsedInspection>();
  for (const { row, res } of work) {
    if (!res.transformerId) continue;
    const cur = newestPerTransformer.get(res.transformerId);
    if (!cur || row.inspectedOn > cur.inspectedOn) newestPerTransformer.set(res.transformerId, row);
  }

  for (const [transformerId, row] of newestPerTransformer) {
    await prisma.transformer.update({
      where: { id: transformerId },
      data: {
        lastInspectionAt: row.inspectedOn,
        structureCondition: row.structure ?? undefined,
        // Fill the substation code if we did not have one. This is what lets a
        // later EMDis upload — which carries no G-Number — find this unit.
        substationCode: row.substationCode || undefined,
        substationName: row.substationName ?? undefined,
      },
    });
  }

  // --- Raise conflicts ------------------------------------------------------
  const conflicts = await raiseConflicts(work);

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      rowsImported: rowsData.filter((r) => r.transformerId).length,
      rowsStaged: rowsData.filter((r) => !r.transformerId).length,
      rowsRejected: rejected.length,
      rowsFlagged: rowsData.filter((r) => r.needsReview).length,
      notes: `${existing.size} row(s) already present and skipped. ${conflicts} conflict(s) raised.`,
    },
  });

  return {
    batchId: batch.id,
    imported: rowsData.filter((r) => r.transformerId).length,
    staged: rowsData.filter((r) => !r.transformerId).length,
    duplicate: existing.size,
    rejected: rejected.length,
    flagged: rowsData.filter((r) => r.needsReview).length,
    conflictsRaised: conflicts,
    transformersTouched: newestPerTransformer.size,
  };
}

/**
 * Where the form disagrees with the register, say so — do not choose.
 *
 * A conflict is only raised when both sides actually assert something. A blank
 * on the form is an inspector who could not read the plate, not a contradiction.
 */
async function raiseConflicts(
  work: { row: ParsedInspection; res: ResolveResult }[],
): Promise<number> {
  const matched = work.filter((w) => w.res.transformerId);
  if (!matched.length) return 0;

  const transformers = await prisma.transformer.findMany({
    where: { id: { in: [...new Set(matched.map((m) => m.res.transformerId!))] } },
    select: {
      id: true,
      gNumber: true,
      serialNumber: true,
      ratingKva: true,
      yearOfManufacture: true,
      manufacturer: { select: { name: true } },
    },
  });
  const byId = new Map(transformers.map((t) => [t.id, t]));

  // Already-open conflicts, so a re-import does not stack duplicates.
  const open = await prisma.recordConflict.findMany({
    where: { transformerId: { in: [...byId.keys()] }, status: "OPEN" },
    select: { transformerId: true, field: true, valueA: true, valueB: true },
  });
  const seen = new Set(open.map((c) => `${c.transformerId}|${c.field}|${c.valueA}|${c.valueB}`));

  const toCreate: Prisma.RecordConflictCreateManyInput[] = [];

  for (const { row, res } of matched) {
    const t = byId.get(res.transformerId!);
    if (!t) continue;

    const checks: [string, string | null, string][] = [
      ["ratingKva", row.ratingKvaAsRecorded != null ? String(row.ratingKvaAsRecorded) : null, String(t.ratingKva)],
      ["yearOfManufacture", row.yomAsRecorded != null ? String(row.yomAsRecorded) : null, String(t.yearOfManufacture)],
      ["make", row.makeAsRecorded, t.manufacturer.name.toUpperCase()],
    ];

    for (const [field, claimed, onRegister] of checks) {
      if (!claimed || claimed === onRegister) continue;
      const key = `${t.id}|${field}|${claimed}|${onRegister}`;
      if (seen.has(key)) continue;
      seen.add(key);
      toCreate.push({
        transformerId: t.id,
        field,
        valueA: claimed,
        sourceA: `Inspection report ${row.reportId}`,
        dateA: row.inspectedOn,
        valueB: onRegister,
        sourceB: "Transformer register",
        status: "OPEN",
      });
    }
  }

  if (toCreate.length) await prisma.recordConflict.createMany({ data: toCreate });
  return toCreate.length;
}
