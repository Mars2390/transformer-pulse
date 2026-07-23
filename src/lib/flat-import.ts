/**
 * Reading a flat load-telemetry table.
 *
 * Not every export is a KPLC EMDis report. A flat table is the ordinary case —
 * one header row, then readings, columns named however the vendor or the
 * technician felt like naming them. This module turns that into the same
 * `EmdisBlock` the EMDis reader produces, so a single commit path ingests both.
 *
 * The column recognition is the universal one; this file only handles the
 * mechanics of finding the header row, reading values under it, and salvaging
 * whatever identity the file volunteers.
 *
 * Pure — a grid in, a block out — so it can be tested without a database.
 */

import { parseEmdisTimestamp, type EmdisBlock, type EmdisRow } from "./emdis-parse";
import { mapColumns, detectFormat, normalise, type CanonField, type ColumnMapping, type FormatDetection } from "./universal-columns";

const num = (v: string | undefined): number | null => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || /^(n\/?a|nil|none|-)$/i.test(s)) return null;
  const n = Number(s.replace(/,/g, "")); // "1,234.5" -> 1234.5
  return Number.isFinite(n) ? n : null;
};

/** Where in the grid the header row sits, for a flat table. */
function findHeaderRow(grid: string[][]): number {
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    if (Object.keys(mapColumns(grid[i]).fieldToIndex).length >= 2) return i;
  }
  return -1;
}

/**
 * Salvage a transformer identity from the lines above the header.
 *
 * Flat tables often carry a few "Serial: 0924…", "Substation: 12345" lines
 * before the table proper. This reads any "key: value" line whose key looks
 * like an identity field. It is best-effort — a table with no such line simply
 * returns nulls, and the engineer picks the transformer in the confirm screen.
 */
function salvageIdentity(preHeader: string[][]) {
  let serial: string | null = null;
  let substationCode: string | null = null;
  let make: string | null = null;
  let ratingKva: number | null = null;

  for (const row of preHeader) {
    for (const cell of row) {
      const c = (cell ?? "").trim();
      const i = c.indexOf(":");
      if (i < 0) continue;
      const key = c.slice(0, i).toLowerCase();
      const val = c.slice(i + 1).trim();
      if (!val) continue;
      if (!serial && /serial/.test(key)) serial = val;
      else if (!substationCode && /(substation|sub\s*no|feeder)/.test(key)) substationCode = val;
      else if (!make && /(make|manufacturer)/.test(key)) make = val.toUpperCase();
      else if (!ratingKva && /(rating|kva|capacity)/.test(key)) {
        const n = Math.round(Number(val.replace(/[^\d.]/g, "")));
        if (Number.isFinite(n) && n > 0) ratingKva = n;
      }
    }
  }
  return { serial, substationCode, make, ratingKva };
}

export type FlatParse = {
  block: EmdisBlock;
  mapping: ColumnMapping;
  detection: FormatDetection;
};

/**
 * Parse a flat grid into one block.
 *
 * `mappingOverride` lets a saved profile or a manual correction in the confirm
 * screen win over the automatic recognition: it maps a raw header string to a
 * canonical field, and is applied on top of whatever the recognizer found.
 * Returns null only when no header row can be found at all.
 */
export function parseFlatTable(
  grid: string[][],
  mappingOverride?: Record<string, CanonField>,
): FlatParse | null {
  const detection = detectFormat(grid);
  const headerIdx = findHeaderRow(grid);
  if (headerIdx < 0) return null;

  const headerRow = grid[headerIdx];
  const mapping = mapColumns(headerRow);

  // Apply overrides: an entry maps a raw header (matched case-insensitively on
  // its normalised form) to a field, replacing whatever the recognizer chose.
  if (mappingOverride) {
    for (const [rawHeader, field] of Object.entries(mappingOverride)) {
      const target = normalise(rawHeader);
      const col = headerRow.findIndex((h) => normalise(h ?? "") === target);
      if (col >= 0) {
        // Drop any previous claimant on this field, then assign.
        for (const k of Object.keys(mapping.fieldToIndex) as CanonField[]) {
          if (mapping.fieldToIndex[k] === col) delete mapping.fieldToIndex[k];
        }
        mapping.fieldToIndex[field] = col;
        const entry = mapping.columns.find((c) => c.index === col);
        if (entry) entry.mappedTo = field;
      }
    }
  }

  const idx = mapping.fieldToIndex;
  const tsCol = idx.recordedAt;
  const rows: EmdisRow[] = [];
  let rejected = 0;

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => !(c ?? "").trim())) continue;

    // Timestamp is required. Without a column for it, fall back to the first
    // cell — flat tables very often lead with an unlabelled date column.
    const rawTs = tsCol != null ? cells[tsCol] : cells[0];
    const recordedAt = rawTs ? parseEmdisTimestamp(String(rawTs)) : null;
    if (!recordedAt) { rejected++; continue; }

    const g = (f: CanonField) => (idx[f] == null ? undefined : cells[idx[f]!]);
    rows.push({
      recordedAt,
      l1nV: num(g("l1nV")), l2nV: num(g("l2nV")), l3nV: num(g("l3nV")),
      l1c: num(g("l1c")), l2c: num(g("l2c")), l3c: num(g("l3c")),
      neutralC: num(g("neutralC")),
      l1l2V: num(g("l1l2V")), l2l3V: num(g("l2l3V")), l3l1V: num(g("l3l1V")),
      kva: num(g("kva")), kw: num(g("kw")), kvar: num(g("kvar")),
      pf: num(g("pf")), hz: num(g("hz")), thdPct: num(g("thdPct")), kwh: num(g("kwh")),
    });
  }

  const identity = salvageIdentity(grid.slice(0, headerIdx));

  return {
    block: {
      header: {
        substationCode: identity.substationCode,
        make: identity.make,
        ratingKva: identity.ratingKva,
        serial: identity.serial,
        deviceId: null,
        timeRange: null,
        exportedAt: null,
      },
      rows,
      rejected,
    },
    mapping,
    detection,
  };
}

/** A stable fingerprint of a header set, for spotting a matching saved profile. */
export function headerSignature(headerRow: string[]): string {
  return headerRow
    .map((h) => normalise(h ?? ""))
    .filter(Boolean)
    .sort()
    .join("|");
}
