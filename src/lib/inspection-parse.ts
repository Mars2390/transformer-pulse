/**
 * Reading KPLC's substation inspection register.
 *
 * This file has one job and it is not "convert strings to numbers". It is to
 * decide, for every value on a form filled in at a roadside pole, whether that
 * value can be trusted — and to make every one of those decisions visible and
 * reversible.
 *
 * Three principles, learned from the real 1,536-row file:
 *
 *   1. A value that cannot be trusted becomes NULL and raises a review flag.
 *      It never becomes a guess. A year of "2811" is not 2011; a rating of
 *      "3*5" is probably 315 but an engineer gets to say so, not this file.
 *
 *   2. Some non-numbers are findings, not blanks. "OL" on an earth tester means
 *      over-limit — the earth is open. Storing that as null deletes a safety
 *      defect. It becomes OPEN_CIRCUIT.
 *
 *   3. The original row is kept verbatim alongside the parsed one, so every
 *      decision here can be argued with later.
 */

import type {
  FuseBarType,
  FuseCarrierState,
  LoadAction,
  MeasurementState,
  StructureCondition,
} from "@/generated/prisma/enums";

/**
 * The vocabulary of "nothing here". The register uses at least nine spellings,
 * including a bare "0" and a lone full stop, and every one of them means the
 * inspector had nothing to write.
 */
const BLANK = /^(none|nil|nill|na|n\/a|n\/a\.|not\s*visible|not\s*labelled|defaced|faded\s*numbers|missing|-|\.|,|)$/i;

export const isBlank = (v: string | undefined | null): boolean =>
  v == null || BLANK.test(v.trim());

const clean = (v: string | undefined | null): string => (v ?? "").trim();

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * "30-Jun-26" -> 2026-06-30, built at UTC midnight.
 *
 * Deliberately not `new Date("30-Jun-26")`. Beyond being unparseable in some
 * runtimes, a date built at LOCAL midnight in Nairobi (UTC+3) serialises as the
 * PREVIOUS day in UTC — the same bug that shifted every meter reading three
 * hours until it was caught.
 */
export function parseInspectionDate(raw: string): Date | null {
  const s = clean(raw);
  if (isBlank(s)) return null;

  const dmy = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[A-Za-z]*[-/\s](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = MONTHS[dmy[2].toLowerCase()];
    if (month == null) return null;
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month, day));
    return isNaN(d.getTime()) ? null : d;
  }

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  return null;
}

/**
 * "14537 - LEE PIC ACADEMY" arrives as a single field. The number is the only
 * part that joins; the name is how a human recognises the place.
 *
 * Some rows carry no number at all ("IOM", "shell mbagathi", "Jocathian"), so
 * the code is allowed to be the whole string — those simply will not match a
 * transformer by substation, which is the correct outcome.
 */
export function splitSubstation(raw: string): { code: string; name: string | null } {
  const s = clean(raw);
  const m = s.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
  if (m) return { code: m[1].toUpperCase(), name: m[2].trim() };
  return { code: s.toUpperCase(), name: null };
}

/**
 * Serial numbers, for MATCHING only.
 *
 * The EMDis export writes 0924020574; the inspection form writes 924020574.
 * They are the same transformer. Without stripping the leading zero the two
 * real KPLC files silently fail to join and the entire analysis is empty.
 */
export function normaliseSerialForMatch(raw: string): string | null {
  const s = clean(raw).toUpperCase();
  if (isBlank(s)) return null;
  // Serials that are a bare number: drop leading zeros. Alphanumeric ones
  // (MEL11KP200/580, K14090913) are left alone — a leading zero there is
  // part of the manufacturer's scheme, not a formatting accident.
  if (/^\d+$/.test(s)) {
    const stripped = s.replace(/^0+/, "");
    return stripped.length ? stripped : null;
  }
  return s.replace(/\s+/g, "");
}

/**
 * G-Numbers. 88% of rows carry a usable one, which makes this the primary key
 * between the two files.
 *
 * Some are written "G159225"; the G is a prefix, not part of the number.
 * Others read "Faded numbers", "Defaced", "4 I'm", "1&59517", "6094/69940" —
 * these are an inspector honestly reporting that the plate was unreadable, and
 * they must not become a number.
 */
export function normaliseGNumber(raw: string): { value: string | null; rejected: string | null } {
  const s = clean(raw);
  if (isBlank(s)) return { value: null, rejected: null };

  const stripped = s.replace(/^G[\s-]?/i, "").replace(/\s+/g, "");
  if (/^\d{2,9}$/.test(stripped)) return { value: stripped, rejected: null };

  return { value: null, rejected: s };
}

/**
 * Year of manufacture.
 *
 * The real file contains 19999, 2811, 2814, 3016, 3009, 1014, 28212, 20, 0,
 * "Jul-71", ",2016", "Refurbished 2020 by MKL" and "Missing". Sixty-nine of
 * 1,427 values are not a plain four-digit year.
 *
 * Anything outside a plausible range is rejected rather than repaired. The
 * temptation is to read 2811 as 2011 — but age drives the health score, and a
 * transformer silently aged by eight centuries is worse than one with no year.
 */
export function parseYom(raw: string, now = new Date()): { value: number | null; reason: string | null } {
  const s = clean(raw);
  if (isBlank(s)) return { value: null, reason: null };

  // "Jul-71", "Mar-24", "Refurbished 2020 by MKL", ",2016" — pull a year if one
  // is unambiguously present, otherwise reject.
  const embedded = s.match(/(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/);
  const candidate = /^\d{4}$/.test(s) ? Number(s) : embedded ? Number(embedded[1]) : NaN;

  if (!Number.isFinite(candidate)) {
    return { value: null, reason: `Year of manufacture unreadable: "${s}"` };
  }
  const thisYear = now.getUTCFullYear();
  if (candidate < 1940 || candidate > thisYear) {
    return { value: null, reason: `Year of manufacture out of range: "${s}"` };
  }
  return { value: candidate, reason: null };
}

/** Standard distribution ratings. "3*5" is almost certainly 315 — but not certainly. */
const RATINGS = new Set([15, 25, 50, 100, 200, 315, 500, 630, 1000]);

export function parseRating(raw: string): { value: number | null; reason: string | null } {
  const s = clean(raw);
  if (isBlank(s)) return { value: null, reason: null };
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, reason: `Rating unreadable: "${s}"` };
  }
  const r = Math.round(n);
  if (!RATINGS.has(r)) {
    return { value: null, reason: `Rating "${s}" is not a standard size` };
  }
  return { value: r, reason: null };
}

export function parseIntField(raw: string): number | null {
  const s = clean(raw);
  if (isBlank(s)) return null;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export type Measurement = {
  ohms: number | null;
  state: MeasurementState;
  /** Set when a number was extracted from text, e.g. "89.9 combined". */
  note: string | null;
};

/**
 * Earth resistance, in OHMS. Not insulation resistance — that is megohms,
 * winding to earth, and lives on TestRecord.
 *
 * The important case is "OL". On an earth tester that is the instrument
 * reporting OVER RANGE (confirmed by KPLC): the resistance is beyond what it can
 * practice means there is no effective earth at all. It appears 46 times in the
 * real file. Treating it as missing data deletes a genuine shock-and-fire
 * hazard from the register; it is a finding and it is stored as one.
 */
export function parseMeasurement(raw: string): Measurement {
  const s = clean(raw);

  if (isBlank(s)) return { ohms: null, state: "NOT_MEASURED", note: null };

  const lower = s.toLowerCase();

  if (/^ol$/.test(lower) || /infinity/.test(lower) || /^open/.test(lower)) {
    return { ohms: null, state: "OPEN_CIRCUIT", note: s };
  }
  if (/vandal|broken|stolen|cut/.test(lower)) {
    return { ohms: null, state: "VANDALISED", note: s };
  }
  if (/not\s*measur|not measuref|^yes$|^no$|^n0$/.test(lower)) {
    // "Yes"/"No" in an ohms column is an inspector answering a different
    // question. There is no reading here.
    return { ohms: null, state: "NOT_MEASURED", note: s };
  }

  // "7ohms", "16ohns", "333ohns", "140 ohms", "89.9 combined", "2 ohms",
  // "Combined with ht e 16.7" — take the number, keep the words.
  const num = s.match(/(\d+(?:\.\d+)?)/);
  if (num) {
    const value = Number(num[1]);
    const hadText = /[a-z]/i.test(s);
    return {
      ohms: value,
      state: "MEASURED",
      note: hadText ? s : null,
    };
  }

  return { ohms: null, state: "NOT_MEASURED", note: s };
}

export function parseStructure(raw: string): StructureCondition | null {
  const s = clean(raw).toLowerCase();
  if (s.includes("rotten")) return "ROTTEN";
  if (s.includes("lean")) return "LEANING";
  if (s.includes("okay") || s.includes("ok")) return "OKAY";
  return null;
}

export function parseFuseCarriers(raw: string): FuseCarrierState | null {
  const s = clean(raw).toLowerCase().replace(/\s+/g, "");
  if (s.includes("needreplacement")) return "NEEDS_REPLACEMENT";
  if (s.includes("okay") || s === "ok") return "OKAY";
  return null;
}

export function parseFuseBar(raw: string): FuseBarType | null {
  const s = clean(raw).toLowerCase().replace(/\s+/g, "");
  if (s.includes("wooden")) return "WOODEN";
  if (s.includes("steady")) return "STEADY_BAR";
  if (s.includes("fusecarriersonpole")) return "FUSE_CARRIERS_ON_POLE";
  // The register spells it "plasctic" throughout. Matching the typo is not
  // sloppiness — it is the only spelling that exists in the source.
  if (s.includes("plas")) return "PLASTIC";
  return null;
}

export function parseLoadAction(raw: string): LoadAction | null {
  const s = clean(raw).toLowerCase().replace(/\s+/g, "");
  if (s.includes("phasebalanc")) return "PHASE_BALANCING";
  if (s.includes("relieve") || s.includes("releive")) return "RELIEVE";
  if (s.includes("additionalcircuit")) return "ADDITIONAL_CIRCUIT";
  if (s.includes("uprate")) return "UPRATE";
  if (s.includes("derate")) return "DERATE";
  return null;
}

/** "yes" / "no" / blank. Blank is unknown, which is not the same as "no". */
export function parseYesNo(raw: string): boolean | null {
  const s = clean(raw).toLowerCase();
  if (s === "yes" || s === "y") return true;
  if (s === "no" || s === "n") return false;
  return null;
}

/**
 * The register's own column names, plus the spellings a human might use when
 * re-exporting it. Matching is done on a normalised header so "Serial No.",
 * "serial no", and "SERIAL_NO" all land in the same place.
 */
export const INSPECTION_ALIASES: Record<string, string[]> = {
  reportId: ["report id", "reportid", "report", "id"],
  inspectionDate: ["inspection date", "inspectiondate", "date", "inspected on"],
  substation: ["substation", "sub station", "substation name", "s/s"],
  region: ["region"],
  county: ["county"],
  inspectedBy: ["inspectedby", "inspected by", "inspector", "staff", "staff no"],
  serialNo: ["serial no.", "serial no", "serialno", "serial number", "serial"],
  voltage: ["voltage", "volts", "kv"],
  rating: ["rating", "rating kva", "kva", "capacity"],
  gNumber: ["gnumber", "g number", "g-number", "gno", "g no"],
  make: ["make", "manufacturer", "brand"],
  yom: ["yom", "year", "year of manufacture", "yr"],
  fuseSize: ["fuse size", "fusesize", "fuse"],
  circuits: ["no. circuits", "no circuits", "nocircuits", "circuits"],
  lvCondSize: ["lv cond size", "lvcondsize", "lv conductor", "lv cond"],
  hvEarth: ["hv earth", "hvearth", "hv earthing"],
  neutralEarth: ["neutral earth", "neutralearth", "n earth"],
  surgeArresters: ["surge arresters", "surgearresters", "surge arrestor", "arresters"],
  gapset: ["gapset", "gap set", "gap"],
  leadSize: ["lead size", "leadsize", "lead"],
  txLoading: ["tx loading", "txloading", "loading"],
  txLoadingYes: ["tx loadingyes", "txloadingyes", "loading yes"],
  loadDistribution: ["load distribution", "loaddistribution", "load action"],
  txStructure: ["tx structure", "txstructure", "structure", "pole"],
  fuseCarriers: ["fuse carriers", "fusecarriers", "carriers"],
  fuseBar: ["fuse bar", "fusebar", "bar"],
  txWiring: ["tx wiring", "txwiring", "wiring"],
  location: ["location", "landmark", "description"],
  actions: ["actions", "action", "remarks"],
};

export function mapInspectionHeaders(headerRow: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  headerRow.forEach((raw, i) => {
    const h = raw.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (!h) return;
    for (const [field, aliases] of Object.entries(INSPECTION_ALIASES)) {
      if (field in index) continue;
      if (aliases.includes(h) || aliases.some((a) => h.replace(/[\s.]/g, "") === a.replace(/[\s.]/g, ""))) {
        index[field] = i;
      }
    }
  });
  return index;
}

export type ParsedInspection = {
  reportId: number;
  inspectedOn: Date;
  substationCode: string;
  substationName: string | null;
  region: string | null;
  county: string | null;
  inspectorRef: string;

  serialAsRecorded: string | null;
  serialForMatch: string | null;
  gNumberAsRecorded: string | null;
  gNumberForMatch: string | null;
  makeAsRecorded: string | null;
  ratingKvaAsRecorded: number | null;
  yomAsRecorded: number | null;
  voltageKv: number | null;

  fuseSizeA: number | null;
  circuits: number | null;
  fuseCarriers: FuseCarrierState | null;
  fuseBarType: FuseBarType | null;

  hvEarth: Measurement;
  neutralEarth: Measurement;
  surgeArrester: Measurement;
  gapsetMm: number | null;

  lvConductorMm2: number | null;
  leadSizeMm2: number | null;

  loadingOk: boolean | null;
  loadAction: LoadAction | null;

  structure: StructureCondition | null;
  locationNote: string | null;

  needsReview: boolean;
  reviewReasons: string[];
  rawRow: Record<string, string>;
};

export type RowOutcome =
  | { ok: true; row: ParsedInspection }
  | { ok: false; reason: string; rawRow: Record<string, string> };

/**
 * Parse one row.
 *
 * Only two things are genuinely required: a report ID (the idempotency key) and
 * a date. Everything else may legitimately be missing — an inspector who could
 * not read the plate still performed a real inspection, and refusing the row
 * would throw away the pole condition, the earth reading and the loading
 * judgement along with it.
 */
export function parseInspectionRow(
  cells: string[],
  headers: Record<string, number>,
): RowOutcome {
  const get = (f: string) => (headers[f] == null ? "" : clean(cells[headers[f]]));

  const rawRow: Record<string, string> = {};
  for (const [field, i] of Object.entries(headers)) rawRow[field] = clean(cells[i]);

  const reportId = Number(get("reportId"));
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return { ok: false, reason: "No usable Report ID", rawRow };
  }

  const inspectedOn = parseInspectionDate(get("inspectionDate"));
  if (!inspectedOn) {
    return { ok: false, reason: `Unreadable inspection date "${get("inspectionDate")}"`, rawRow };
  }

  const reviewReasons: string[] = [];

  const { code, name } = splitSubstation(get("substation"));
  const gRaw = get("gNumber");
  const g = normaliseGNumber(gRaw);
  if (g.rejected) reviewReasons.push(`G-Number unreadable on the plate: "${g.rejected}"`);

  const yom = parseYom(get("yom"));
  if (yom.reason) reviewReasons.push(yom.reason);

  const rating = parseRating(get("rating"));
  if (rating.reason) reviewReasons.push(rating.reason);

  const hvEarth = parseMeasurement(get("hvEarth"));
  const neutralEarth = parseMeasurement(get("neutralEarth"));
  const surgeArrester = parseMeasurement(get("surgeArresters"));

  if (hvEarth.state === "OPEN_CIRCUIT") reviewReasons.push("HV earth read OL (over range) — no effective earth");
  if (neutralEarth.state === "OPEN_CIRCUIT") reviewReasons.push("Neutral earth read OL (over range) — no effective earth");
  if (hvEarth.state === "VANDALISED" || neutralEarth.state === "VANDALISED") {
    reviewReasons.push("Earth conductor reported vandalised");
  }

  const serialRaw = get("serialNo");

  return {
    ok: true,
    row: {
      reportId,
      inspectedOn,
      substationCode: code,
      substationName: name,
      region: isBlank(get("region")) ? null : get("region"),
      county: isBlank(get("county")) ? null : get("county"),
      inspectorRef: get("inspectedBy") || "UNKNOWN",

      serialAsRecorded: isBlank(serialRaw) ? null : serialRaw,
      serialForMatch: normaliseSerialForMatch(serialRaw),
      gNumberAsRecorded: isBlank(gRaw) ? null : gRaw,
      gNumberForMatch: g.value,
      makeAsRecorded: isBlank(get("make")) ? null : get("make").toUpperCase(),
      ratingKvaAsRecorded: rating.value,
      yomAsRecorded: yom.value,
      voltageKv: parseIntField(get("voltage")),

      fuseSizeA: parseIntField(get("fuseSize")),
      circuits: parseIntField(get("circuits")),
      fuseCarriers: parseFuseCarriers(get("fuseCarriers")),
      fuseBarType: parseFuseBar(get("fuseBar")),

      hvEarth,
      neutralEarth,
      surgeArrester,
      gapsetMm: parseIntField(get("gapset")),

      lvConductorMm2: parseIntField(get("lvCondSize")),
      leadSizeMm2: parseIntField(get("leadSize")),

      loadingOk: parseYesNo(get("txLoading")),
      loadAction: parseLoadAction(get("loadDistribution")),

      structure: parseStructure(get("txStructure")),
      locationNote: isBlank(get("location")) ? null : get("location"),

      needsReview: reviewReasons.length > 0,
      reviewReasons,
      rawRow,
    },
  };
}
