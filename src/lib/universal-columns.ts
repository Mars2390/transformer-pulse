/**
 * Universal column recognition for load telemetry.
 *
 * KPLC's EMDis export is one shape. The moment a second meter vendor, a
 * spreadsheet a technician typed by hand, or a SCADA dump arrives, the columns
 * are named differently — "L1 Current", "Ia", "IR", "Red Phase", "R", "IL1" all
 * mean the same current. This module maps whatever a file calls its columns onto
 * the canonical fields the analysis engine expects, and says plainly which
 * columns it could not place so an engineer confirms rather than trusts a guess.
 *
 * Pure, no I/O — so the mapping can be tested against a header row directly.
 *
 * CONVENTION (a labelled assumption): phase identity follows the Kenyan R-Y-B
 * colour order — Red = L1, Yellow = L2, Blue = L3 — and the letter order a-b-c
 * maps 1-2-3. Where a header is genuinely ambiguous the column is returned
 * UNMAPPED for the engineer to assign, never silently forced.
 */

/** The fields the load engine understands. Everything maps onto one of these. */
export type CanonField =
  | "recordedAt"
  | "l1c" | "l2c" | "l3c" | "neutralC"
  | "l1nV" | "l2nV" | "l3nV"
  | "l1l2V" | "l2l3V" | "l3l1V"
  | "kva" | "kw" | "kvar" | "pf" | "hz" | "thdPct" | "kwh";

export const CANON_LABEL: Record<CanonField, string> = {
  recordedAt: "Timestamp",
  l1c: "L1 current (A)", l2c: "L2 current (A)", l3c: "L3 current (A)", neutralC: "Neutral current (A)",
  l1nV: "L1-N voltage (V)", l2nV: "L2-N voltage (V)", l3nV: "L3-N voltage (V)",
  l1l2V: "L1-L2 voltage (V)", l2l3V: "L2-L3 voltage (V)", l3l1V: "L3-L1 voltage (V)",
  kva: "Apparent power (kVA)", kw: "Real power (kW)", kvar: "Reactive power (kVAr)",
  pf: "Power factor", hz: "Frequency (Hz)", thdPct: "THD (%)", kwh: "Energy (kWh)",
};

/**
 * Alias table. Each canonical field lists the header spellings that map to it,
 * already lower-cased and stripped of spaces/units the way `normalise()` does.
 * Order matters only for readability; matching is exact against the normalised
 * header, then a looser contains-based pass for the obvious cases.
 */
const ALIASES: Record<CanonField, string[]> = {
  recordedAt: ["timestamp", "time", "datetime", "date/time", "readingtime", "recordedat", "readtime", "date"],

  // Currents. R/red = L1, Y/yellow = L2, B/blue = L3; a/b/c = 1/2/3.
  // Note the deliberate absence of a plain "ib": it means phase-b (L2) under the
  // a-b-c convention but Blue (L3) under R-Y-B, so it is resolved from its
  // siblings in resolveAmbiguous(), never hard-coded to one field.
  l1c: ["l1c", "l1current", "l1amps", "l1a", "currentl1", "ia", "il1", "ir", "iredphase", "redphase",
        "redphasecurrent", "rphasecurrent", "phaseacurrent", "phasea", "i1", "il1", "amp1", "current1"],
  l2c: ["l2c", "l2current", "l2amps", "l2a", "currentl2", "il2", "iy", "iyellow",
        "yellowphase", "yellowphasecurrent", "yphasecurrent", "phasebcurrent", "phaseb", "i2", "amp2", "current2"],
  l3c: ["l3c", "l3current", "l3amps", "l3a", "currentl3", "il3", "ic", "iblue",
        "bluephase", "bluephasecurrent", "bphasecurrent", "phaseccurrent", "phasec", "i3", "amp3", "current3"],
  neutralC: ["nc", "neutralcurrent", "in", "ineutral", "neutral", "neutrala", "currentneutral", "i_n", "npcurrent"],

  // Phase-to-neutral voltages.
  l1nV: ["l1nv", "l1n", "vl1", "vl1n", "v1n", "vrn", "vr", "l1voltage", "phaseavoltage", "voltagel1", "vln1", "v_r"],
  l2nV: ["l2nv", "l2n", "vl2", "vl2n", "v2n", "vyn", "vy", "l2voltage", "phasebvoltage", "voltagel2", "vln2", "v_y"],
  l3nV: ["l3nv", "l3n", "vl3", "vl3n", "v3n", "vbn", "vb", "l3voltage", "phasecvoltage", "voltagel3", "vln3", "v_b"],

  // Line-to-line voltages.
  l1l2V: ["l1l2v", "l1l2", "vl1l2", "v12", "vry", "vrs", "l1l2voltage", "vll12"],
  l2l3V: ["l2l3v", "l2l3", "vl2l3", "v23", "vyb", "vst", "l2l3voltage", "vll23"],
  l3l1V: ["l3l1v", "l3l1", "vl3l1", "v31", "vbr", "vtr", "l3l1voltage", "vll31"],

  kva: ["kva", "apparentpower", "s", "totalkva", "skva"],
  kw: ["kw", "realpower", "activepower", "p", "totalkw", "pkw"],
  kvar: ["kvar", "reactivepower", "q", "totalkvar", "var"],
  pf: ["pf", "powerfactor", "cosphi", "cos", "pftotal", "dpf"],
  hz: ["hz", "frequency", "freq", "f"],
  thdPct: ["thd", "thdpct", "thd%", "thdi", "thdv", "totalharmonicdistortion", "harmonicdistortion"],
  kwh: ["kwh", "energy", "activeenergy", "totalenergy", "wh"],
};

/** Lower-case, drop spaces, units in parens, and most punctuation. */
export function normalise(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, "") // "(A)", "(V)", "(kVA)"
    .replace(/[\s._\-/\\]+/g, "")
    .replace(/[^a-z0-9%]/g, "")
    .trim();
}

export type ColumnMapping = {
  /** field -> source column index */
  fieldToIndex: Partial<Record<CanonField, number>>;
  /** Every source column, with what it was recognised as (or null). */
  columns: { index: number; header: string; mappedTo: CanonField | null }[];
  /** Source headers we could not place. */
  unmapped: string[];
  /** Canonical fields nothing filled. */
  missing: CanonField[];
};

/**
 * Map a header row onto canonical fields.
 *
 * A column matches a field when its normalised header equals one of the field's
 * aliases. First writer wins, so a file with both "L1C" and "L1 Current" keeps
 * the first and reports the second as a duplicate in `unmapped` — better than
 * silently overwriting.
 */
export function mapColumns(headerRow: string[]): ColumnMapping {
  const fieldToIndex: Partial<Record<CanonField, number>> = {};
  const columns: ColumnMapping["columns"] = [];
  const unmapped: string[] = [];

  const aliasIndex = new Map<string, CanonField>();
  for (const [field, list] of Object.entries(ALIASES) as [CanonField, string[]][]) {
    for (const a of list) if (!aliasIndex.has(a)) aliasIndex.set(a, field);
  }

  // Resolve the one ambiguous current token "ib" from what else is in the file.
  // If a Yellow current ("iy") is present the file is using R-Y-B colours, so
  // "ib" is Blue = L3. If an "ia" is present it is the a-b-c scheme, so "ib" is
  // phase-b = L2. With neither sibling to disambiguate, default to the Kenyan
  // R-Y-B reading (Blue = L3) — the convention KPLC actually prints.
  const norms = headerRow.map((h) => normalise(h ?? ""));
  const ibTarget: CanonField = norms.includes("iy") ? "l3c" : norms.includes("ia") ? "l2c" : "l3c";
  if (!aliasIndex.has("ib")) aliasIndex.set("ib", ibTarget);

  headerRow.forEach((raw, index) => {
    const header = (raw ?? "").trim();
    if (!header) {
      columns.push({ index, header, mappedTo: null });
      return;
    }
    const n = normalise(header);
    let field = aliasIndex.get(n) ?? null;

    // Second pass: an alias contained in a longer header, e.g. "avg l1 current a"
    // normalises to "avgl1currenta" — try the distinctive current/voltage aliases.
    if (!field) {
      for (const [alias, f] of aliasIndex) {
        if (alias.length >= 3 && n.includes(alias) && !(f in fieldToIndex)) { field = f; break; }
      }
    }

    if (field && !(field in fieldToIndex)) {
      fieldToIndex[field] = index;
      columns.push({ index, header, mappedTo: field });
    } else {
      columns.push({ index, header, mappedTo: null });
      unmapped.push(header);
    }
  });

  const missing = (Object.keys(ALIASES) as CanonField[]).filter((f) => !(f in fieldToIndex));
  return { fieldToIndex, columns, unmapped, missing };
}

export type FormatDetection = {
  /** "emdis" if the KPLC report wrapper is present, else "flat-table". */
  layout: "emdis" | "flat-table" | "unknown";
  phases: 1 | 3 | 0;
  hasCurrent: boolean;
  hasVoltage: boolean;
  hasPower: boolean;
  hasTimestamp: boolean;
  /** Human-readable summary for the preview screen. */
  summary: string;
};

/**
 * Look at the first rows of a grid and say what kind of file this is, so the
 * preview screen can lead with "Detected: flat table, three-phase, current +
 * voltage" instead of making the engineer guess whether it will import.
 */
export function detectFormat(grid: string[][]): FormatDetection {
  const firstCells = grid.slice(0, 12).map((r) => (r[0] ?? "").trim());
  const isEmdis = firstCells.some((c) => /^Transformer Substation\s*:/i.test(c));

  // The header row is the EMDis "timestamp" line, or — for a flat table — the
  // first row that maps at least two canonical fields.
  let headerRow: string[] | null = null;
  if (isEmdis) {
    headerRow = grid.find((r) => /^timestamp$/i.test((r[0] ?? "").trim())) ?? null;
  } else {
    for (const r of grid.slice(0, 8)) {
      if (mapColumnsCount(r) >= 2) { headerRow = r; break; }
    }
  }

  if (!headerRow) {
    return {
      layout: isEmdis ? "emdis" : "unknown", phases: 0,
      hasCurrent: false, hasVoltage: false, hasPower: false, hasTimestamp: false,
      summary: "No recognisable header row — the columns could not be identified.",
    };
  }

  const m = mapColumns(headerRow);
  const has = (f: CanonField) => f in m.fieldToIndex;
  const currents = ["l1c", "l2c", "l3c"].filter((f) => has(f as CanonField)).length;
  const hasCurrent = currents > 0;
  const hasVoltage = has("l1nV") || has("l2nV") || has("l3nV") || has("l1l2V");
  const hasPower = has("kva") || has("kw");
  const hasTimestamp = has("recordedAt");
  const phases: 1 | 3 | 0 = currents >= 2 ? 3 : currents === 1 ? 1 : 0;

  const parts: string[] = [];
  parts.push(isEmdis ? "KPLC EMDis report" : "flat table");
  if (phases === 3) parts.push("three-phase");
  else if (phases === 1) parts.push("single-phase");
  const measures = [hasCurrent && "current", hasVoltage && "voltage", hasPower && "power"].filter(Boolean);
  if (measures.length) parts.push(measures.join(" + "));

  return {
    layout: isEmdis ? "emdis" : "flat-table",
    phases, hasCurrent, hasVoltage, hasPower, hasTimestamp,
    summary: parts.join(", "),
  };
}

function mapColumnsCount(row: string[]): number {
  return Object.keys(mapColumns(row).fieldToIndex).length;
}
