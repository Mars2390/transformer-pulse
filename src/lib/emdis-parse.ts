/**
 * Reading a KPLC EMDis export.
 *
 * The file is not a table. It is a report: seven metadata lines naming the
 * transformer, a blank, then a header row, then the readings — and the whole
 * block repeats if the export covers more than one unit. A plain CSV parser
 * reads the first line as the header, produces eighteen columns called
 * "Unnamed: 1" through "Unnamed: 17", and finds nothing.
 *
 * The header carries a substation number and a serial but NO G-Number, which
 * is why an EMDis upload can only find its transformer through the mapping the
 * inspection register provides.
 */

export type EmdisBlockHeader = {
  substationCode: string | null;
  make: string | null;
  ratingKva: number | null;
  serial: string | null;
  deviceId: string | null;
  timeRange: string | null;
  exportedAt: string | null;
};

export type EmdisRow = {
  recordedAt: Date;
  l1nV: number | null; l2nV: number | null; l3nV: number | null;
  l1c: number | null; l2c: number | null; l3c: number | null;
  neutralC: number | null;
  l1l2V: number | null; l2l3V: number | null; l3l1V: number | null;
  kva: number | null; kw: number | null; kvar: number | null;
  pf: number | null; hz: number | null; thdPct: number | null; kwh: number | null;
};

export type EmdisBlock = {
  header: EmdisBlockHeader;
  rows: EmdisRow[];
  rejected: number;
};

const num = (v: string | undefined): number | null => {
  if (v == null) return null;
  const s = v.trim();
  if (!s || /^(n\/?a|nil|none|-)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Timestamps are read as UTC unless they say otherwise.
 *
 * Deliberately not `new Date("2025-12-11 14:40:18")`, which JavaScript treats
 * as LOCAL time. In Nairobi that shifts every reading three hours and the
 * evening peak lands in the afternoon — the same bug that had to be fixed in
 * the meter pipeline.
 */
export function parseEmdisTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));

  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], +dmy[4], +dmy[5], +(dmy[6] ?? 0)));

  return null;
}

/** "Transformer Rating (KVA): 315" -> 315 */
function headerValue(line: string): string | null {
  const i = line.indexOf(":");
  if (i < 0) return null;
  const v = line.slice(i + 1).replace(/,+$/, "").trim();
  return v && !/^(n\/?a|none|nil)$/i.test(v) ? v : null;
}

/**
 * Split an export into per-transformer blocks.
 *
 * `grid` is the file already split into cells — the same CSV/XLSX reader the
 * rest of the system uses, so quoted fields and Excel dates behave identically
 * here and in the asset importer.
 */
export function parseEmdisBlocks(grid: string[][]): EmdisBlock[] {
  const blocks: EmdisBlock[] = [];
  let current: EmdisBlock | null = null;
  let colIndex: Record<string, number> | null = null;

  const COLUMNS: Record<string, string[]> = {
    recordedAt: ["timestamp", "time", "datetime"],
    l1nV: ["l1nv (v)", "l1nv", "l1n v"],
    l2nV: ["l2nv (v)", "l2nv", "l2n v"],
    l3nV: ["l3nv (v)", "l3nv", "l3n v"],
    l1c: ["l1c (a)", "l1c", "l1 current"],
    l2c: ["l2c (a)", "l2c", "l2 current"],
    l3c: ["l3c (a)", "l3c", "l3 current"],
    neutralC: ["nc (a)", "nc", "neutral current", "in"],
    l1l2V: ["l1l2v (v)", "l1l2v"],
    l2l3V: ["l2l3v (v)", "l2l3v"],
    l3l1V: ["l3l1v (v)", "l3l1v"],
    kva: ["kva"], kw: ["kw"], kvar: ["kvar"],
    pf: ["pf", "power factor"], hz: ["hz", "frequency"],
    thdPct: ["thd (%)", "thd", "thd%"], kwh: ["kwh"],
  };

  const mapHeader = (row: string[]): Record<string, number> => {
    const idx: Record<string, number> = {};
    row.forEach((raw, i) => {
      const h = raw.toLowerCase().trim().replace(/\s+/g, " ");
      for (const [field, aliases] of Object.entries(COLUMNS)) {
        if (field in idx) continue;
        if (aliases.includes(h) || aliases.some((a) => h.replace(/[\s()%]/g, "") === a.replace(/[\s()%]/g, ""))) {
          idx[field] = i;
        }
      }
    });
    return idx;
  };

  for (const cells of grid) {
    const first = (cells[0] ?? "").trim();
    if (!first && cells.every((c) => !c?.trim())) continue;

    // A new transformer block begins.
    if (/^Transformer Substation\s*:/i.test(first)) {
      current = {
        header: {
          substationCode: headerValue(first),
          make: null, ratingKva: null, serial: null,
          deviceId: null, timeRange: null, exportedAt: null,
        },
        rows: [],
        rejected: 0,
      };
      blocks.push(current);
      colIndex = null;
      continue;
    }
    if (!current) continue;

    if (/^Transformer Make\s*:/i.test(first)) { current.header.make = headerValue(first)?.toUpperCase() ?? null; continue; }
    if (/^Transformer Rating/i.test(first)) { const v = headerValue(first); current.header.ratingKva = v ? Math.round(Number(v.replace(/[^\d.]/g, ""))) || null : null; continue; }
    if (/^Transformer Serial/i.test(first)) { current.header.serial = headerValue(first); continue; }
    if (/^Device ID\s*:/i.test(first)) { current.header.deviceId = headerValue(first); continue; }
    if (/^Time Range\s*:/i.test(first)) { current.header.timeRange = headerValue(first); continue; }
    if (/^Export Date\s*:/i.test(first)) { current.header.exportedAt = headerValue(first); continue; }

    // The reading header.
    if (/^timestamp$/i.test(first)) { colIndex = mapHeader(cells); continue; }

    // A reading.
    if (colIndex && /^\d{4}-\d{2}-\d{2}/.test(first)) {
      const g = (f: string) => (colIndex![f] == null ? undefined : cells[colIndex![f]]);
      const recordedAt = parseEmdisTimestamp(first);
      if (!recordedAt) { current.rejected++; continue; }
      current.rows.push({
        recordedAt,
        l1nV: num(g("l1nV")), l2nV: num(g("l2nV")), l3nV: num(g("l3nV")),
        l1c: num(g("l1c")), l2c: num(g("l2c")), l3c: num(g("l3c")),
        neutralC: num(g("neutralC")),
        l1l2V: num(g("l1l2V")), l2l3V: num(g("l2l3V")), l3l1V: num(g("l3l1V")),
        kva: num(g("kva")), kw: num(g("kw")), kvar: num(g("kvar")),
        pf: num(g("pf")), hz: num(g("hz")), thdPct: num(g("thdPct")), kwh: num(g("kwh")),
      });
    }
  }

  return blocks.filter((b) => b.rows.length > 0);
}

/** Serial normalisation must match the inspection side exactly, or nothing joins. */
export function normaliseSerialForMatch(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!s || /^(n\/?a|none|nil)$/i.test(s)) return null;
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped.length ? stripped : null;
  }
  return s.replace(/\s+/g, "");
}
