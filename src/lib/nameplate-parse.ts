/**
 * Reading a transformer nameplate out of OCR text.
 *
 * WHY THE PREVIOUS VERSION FOUND ALMOST NOTHING
 *
 * It matched on units: /(\d+)\s*kVA/, /(50|60)\s*Hz/, /(\d+)\s*KG/. That works
 * on a plate that says "315 kVA" as a phrase. It does not work on the plates
 * KPLC actually receives, which are two-column tables where the unit lives in
 * the LABEL and the number sits in a separate column:
 *
 *     Rating (KVA)            3500
 *     Frequency (Hz)          50
 *     Oil weight (kg)         2200
 *
 * There is no "3500 kVA" substring anywhere in that text. The unit comes BEFORE
 * the number, inside brackets, often with centimetres of whitespace between
 * them — and when the columns are far apart, Tesseract frequently emits the
 * label and the value as two separate lines.
 *
 * So this parser is LABEL-anchored, not unit-anchored. It finds the row by its
 * label, then takes the value from the rest of that line, or from the next line
 * or two if the rest of the line has no number in it. Unit-anchored matching is
 * kept as a fallback for plates that really are written "315 kVA".
 *
 * WHY IT REFUSES MORE THAN IT USED TO
 *
 * On the ABB plate in the field photos, the impedance row is BLANK, and the old
 * parser filled it with 6 — scraped from "IEC 60076" or the tapping table
 * elsewhere in the image. A wrong value presented as a finding is worse than a
 * blank, because the keeper confirms it without thinking. Every field here is
 * range-checked, and a value that cannot be tied to its own label is dropped
 * rather than guessed.
 */

export type Confidence = "high" | "medium" | "low";

export type Field<T> = {
  value: T | null;
  confidence: Confidence;
  /** The exact text this came from, so a human can check the machine's work. */
  source: string | null;
};

export type NameplateExtract = {
  serialNumber: Field<string>;
  ratingKva: Field<number>;
  primaryKv: Field<number>;
  secondaryKv: Field<number>;
  yearOfManufacture: Field<number>;
  frequencyHz: Field<number>;
  coolingType: Field<string>;
  vectorGroup: Field<string>;
  impedancePct: Field<number>;
  oilVolumeLitres: Field<number>;
  totalWeightKg: Field<number>;
  manufacturerGuess: Field<string>;
  /** Plates that give oil as a MASS cannot be converted to litres honestly. */
  oilWeightKgNoted: number | null;
  matchedCount: number;
  totalFields: number;
};

const NONE: Field<never> = { value: null, confidence: "low", source: null };

function none<T>(): Field<T> {
  return NONE as unknown as Field<T>;
}

function hit<T>(value: T, confidence: Confidence, source: string): Field<T> {
  return { value, confidence, source: source.trim().slice(0, 80) };
}

/**
 * Digits that Tesseract habitually confuses, corrected ONLY inside a run that
 * is otherwise numeric. Applying these to free text would turn "ONAN" into
 * "0NAN", so the guard matters more than the substitutions.
 */
function repairNumeric(raw: string): string {
  return raw
    .replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0")
    .replace(/[lI](?=\d)|(?<=\d)[lI]/g, "1")
    .replace(/(?<=\d)[Ss]|[Ss](?=\d\d)/g, "5")
    .replace(/(?<=\d)[B](?=\d)/g, "8");
}

function toNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = repairNumeric(raw).replace(/[^\d.,]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Split into trimmed, non-empty lines. Tesseract's line breaks are the grid. */
function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

type ValueOpts = {
  /** How many following lines may hold the value when the label line has none. */
  lookahead?: number;
  /** Reject anything outside this range rather than reporting a wrong number. */
  min?: number;
  max?: number;
};

/**
 * Find a labelled row and return the numeric value belonging to it.
 *
 * The scan is confined to the label's own line and at most `lookahead` lines
 * after it. That confinement is the whole safety property: it is what stops a
 * blank Impedance row picking up a stray 6 from IEC 60076 three rows away.
 */
function numberForLabel(
  lines: string[],
  label: RegExp,
  opts: ValueOpts = {},
): { value: number; source: string; sameLine: boolean } | null {
  const { lookahead = 2, min = -Infinity, max = Infinity } = opts;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(label);
    if (!m) continue;

    // Everything after the label text on the same line, minus any bracketed
    // unit the label carried: "Rating (KVA) 3500" -> "3500".
    const tail = line.slice((m.index ?? 0) + m[0].length).replace(/^\s*\([^)]*\)\s*/, "");
    const sameLine = tail.match(/-?\d[\d.,]*/);
    if (sameLine) {
      const n = toNumber(sameLine[0]);
      if (n != null && n >= min && n <= max) {
        return { value: n, source: line, sameLine: true };
      }
    }

    // Two-column plate: the value landed on its own line.
    for (let j = 1; j <= lookahead && i + j < lines.length; j++) {
      const next = lines[i + j];
      // A line that is itself another label is the end of this row, not its value.
      if (/[A-Za-z]{4,}.*[A-Za-z]{4,}/.test(next) && !/^\s*[\d.,\s/]+$/.test(next)) break;
      const v = next.match(/-?\d[\d.,]*/);
      if (v) {
        const n = toNumber(v[0]);
        if (n != null && n >= min && n <= max) {
          return { value: n, source: `${line} → ${next}`, sameLine: false };
        }
      }
    }
  }
  return null;
}

/** Same idea, for values that are words rather than numbers. */
function textForLabel(
  lines: string[],
  label: RegExp,
  valuePattern: RegExp,
  lookahead = 2,
): { value: string; source: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    const tail = lines[i].slice((m.index ?? 0) + m[0].length);
    const here = tail.match(valuePattern);
    if (here) return { value: here[0].toUpperCase().replace(/\s+/g, ""), source: lines[i] };
    for (let j = 1; j <= lookahead && i + j < lines.length; j++) {
      const next = lines[i + j].match(valuePattern);
      if (next) return { value: next[0].toUpperCase().replace(/\s+/g, ""), source: `${lines[i]} → ${lines[i + j]}` };
    }
  }
  return null;
}

/** Manufacturers KPLC actually buys from, plus the spellings OCR produces. */
const MAKERS: { name: string; patterns: RegExp[] }[] = [
  { name: "ABB", patterns: [/\bABB\b/, /\bA8B\b/, /\bAB8\b/] },
  { name: "TELK", patterns: [/\bTELK\b/, /\bTELCO\b/, /\bT3LK\b/] },
  { name: "Siemens", patterns: [/\bSIEMENS\b/, /\bS1EMENS\b/] },
  { name: "PANFRICA", patterns: [/\bPAN\s?AFRICA\w*\b/, /\bPANFRICA\b/] },
  { name: "Schneider", patterns: [/\bSCHNEIDER\b/] },
  { name: "Kirloskar", patterns: [/\bKIRLOSKAR\b/] },
  { name: "Crompton", patterns: [/\bCROMPTON\b/] },
];

export function parseNameplate(rawText: string): NameplateExtract {
  const text = rawText ?? "";
  const lines = toLines(text);
  const upper = text.toUpperCase();
  const upperLines = lines.map((l) => l.toUpperCase());

  let serialNumber = none<string>();
  const serialRow = textForLabel(
    upperLines,
    /SERIAL\s*(?:NUMBER|NO\.?|N[o°])?|\bS[\/.]?N[o°]?\b|\bSR\.?\s*NO\.?/,
    /[A-Z0-9][A-Z0-9\-\/]{4,24}/,
  );
  if (serialRow) serialNumber = hit(serialRow.value, "high", serialRow.source);

  // Inline first, because "315 kVA" is unambiguous when it exists. Only then
  // label-anchored, because "Rating (KVA)  3500" has no such substring.
  //
  // The bare unit is NOT used as a label: on "315 kVA 11/0.433 kV" the text
  // after "kVA" is "11", so treating the unit as a label reads the voltage as
  // the rating. On these plates the number comes BEFORE the unit and AFTER the
  // word — those are two different rules and they must stay separate.
  let ratingKva = none<number>();
  const inlineKva = upper.match(/(\d{1,5}(?:[.,]\d+)?)\s*-?\s*K\s?VA\b/);
  const inlineN = toNumber(inlineKva?.[1]);
  if (inlineN != null && inlineN >= 5 && inlineN <= 20000) {
    ratingKva = hit(Math.round(inlineN), "high", inlineKva![0]);
  } else {
    const inlineMva = upper.match(/(\d{1,3}(?:[.,]\d+)?)\s*-?\s*M\s?VA\b/);
    const mvaN = toNumber(inlineMva?.[1]);
    if (mvaN != null && mvaN > 0 && mvaN <= 20) {
      ratingKva = hit(Math.round(mvaN * 1000), "high", inlineMva![0]);
    } else {
      const ratingRow = numberForLabel(upperLines, /RAT(?:ING|ED)\s*(?:POWER|OUTPUT)?|\bCAPACITY\b/, {
        min: 5,
        max: 20000,
      });
      if (ratingRow) {
        ratingKva = hit(
          Math.round(ratingRow.value),
          ratingRow.sameLine ? "high" : "medium",
          ratingRow.source,
        );
      }
    }
  }

  // A ratio like 11/0.433 or 11000/433 is the reliable form. Bare "HV"/"LV"
  // rows are common too. Anything over 1000 is volts and is brought to kV.
  let primaryKv = none<number>();
  let secondaryKv = none<number>();
  const ratio = upper.match(/(\d{2,6}(?:[.,]\d+)?)\s*\/\s*(\d{1,6}(?:[.,]\d+)?)\s*(?:K\s?V|VOLTS?)\b/) ??
    upper.match(/(?:VOLTAGE|VOLTS?)[^\d]{0,12}(\d{2,6}(?:[.,]\d+)?)\s*\/\s*(\d{1,6}(?:[.,]\d+)?)/);
  if (ratio) {
    const hv0 = toNumber(ratio[1]);
    const lv0 = toNumber(ratio[2]);
    if (hv0 != null && lv0 != null) {
      const hv = hv0 > 1000 ? hv0 / 1000 : hv0;
      const lv = lv0 > 1000 ? lv0 / 1000 : lv0;
      if (hv > 0.1 && hv <= 400 && lv > 0.05 && lv < hv) {
        primaryKv = hit(hv, "medium", ratio[0]);
        secondaryKv = hit(lv, "medium", ratio[0]);
      }
    }
  }

  let yearOfManufacture = none<number>();
  const thisYear = new Date().getFullYear();
  const yearRow = numberForLabel(
    upperLines,
    /(?:MANUFACTUR\w*\s*(?:DATE|YEAR)|YEAR\s*OF\s*MANUFACTURE|\bYOM\b|\bMFG\b\.?\s*(?:DATE)?|DATE\s*OF\s*MANUFACTURE)/,
    { min: 1950, max: thisYear, lookahead: 1 },
  );
  if (yearRow) yearOfManufacture = hit(Math.round(yearRow.value), "high", yearRow.source);
  else {
    const bare = upper.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    const n = toNumber(bare?.[1]);
    if (n != null && n <= thisYear) yearOfManufacture = hit(n, "low", bare![0]);
  }

  let frequencyHz = none<number>();
  const freqRow = numberForLabel(upperLines, /FREQ\w*/, { min: 45, max: 65, lookahead: 1 });
  if (freqRow && (Math.round(freqRow.value) === 50 || Math.round(freqRow.value) === 60)) {
    frequencyHz = hit(Math.round(freqRow.value), "high", freqRow.source);
  } else {
    const inline = upper.match(/\b(50|60)\s*HZ\b/);
    if (inline) frequencyHz = hit(Number(inline[1]), "high", inline[0]);
  }

  let coolingType = none<string>();
  const coolRow = textForLabel(upperLines, /COOL\w*/, /\b(ONAN|ONAF|OFAF|OFAN|KNAN|KNAF|ODAF)\b/, 1);
  if (coolRow) coolingType = hit(coolRow.value, "high", coolRow.source);
  else {
    const bare = upper.match(/\b(ONAN|ONAF|OFAF|OFAN|KNAN|KNAF|ODAF)\b/);
    if (bare) coolingType = hit(bare[1], "medium", bare[0]);
  }

  let vectorGroup = none<string>();
  const vecRow = textForLabel(
    upperLines,
    /VECTOR\s*(?:GROUP)?|CONNECTION\s*SYMBOL|\bVG\b/,
    /\b(D\s?YN\s?\d{1,2}|Y\s?YN\s?\d{1,2}|Y\s?ZN\s?\d{1,2}|D\s?D\s?\d{1,2}|Y\s?Y\s?\d{1,2})\b/,
    1,
  );
  if (vecRow) vectorGroup = hit(vecRow.value.replace(/^DYN/, "Dyn").replace(/^YYN/, "Yyn").replace(/^YZN/, "Yzn"), "high", vecRow.source);
  else {
    const bare = upper.match(/\b(D\s?YN\s?\d{1,2}|Y\s?YN\s?\d{1,2}|Y\s?ZN\s?\d{1,2})\b/);
    if (bare) {
      const v = bare[1].replace(/\s+/g, "");
      vectorGroup = hit(v.replace(/^DYN/, "Dyn").replace(/^YYN/, "Yyn").replace(/^YZN/, "Yzn"), "medium", bare[0]);
    }
  }

  // The row that caused the trouble. Confined to its own label, range-checked,
  // and left blank when the plate leaves it blank.
  let impedancePct = none<number>();
  const impRow = numberForLabel(upperLines, /IMPEDANCE(?:\s*VOLTAGE)?|\bUK\b|\bU[KZ]\s*%/, {
    min: 1,
    max: 25,
    lookahead: 1,
  });
  if (impRow) impedancePct = hit(impRow.value, impRow.sameLine ? "high" : "medium", impRow.source);
  else {
    const inline = upper.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    const n = toNumber(inline?.[1]);
    if (n != null && n >= 1 && n <= 25) impedancePct = hit(n, "low", inline![0]);
  }

  // Litres and kilograms are different quantities. A plate giving oil MASS is
  // recorded as a note, not silently divided by a density nobody measured.
  let oilVolumeLitres = none<number>();
  let oilWeightKgNoted: number | null = null;
  const oilVolRow = numberForLabel(upperLines, /OIL\s*(?:VOLUME|QUANTITY|QTY|CAPACITY)|VOLUME\s*OF\s*OIL/, {
    min: 5,
    max: 30000,
    lookahead: 1,
  });
  if (oilVolRow) oilVolumeLitres = hit(Math.round(oilVolRow.value), "high", oilVolRow.source);
  else {
    const inline = upper.match(/(\d{2,6})\s*(?:LITRES?|LITERS?|LTR|\bL\b)/);
    const n = toNumber(inline?.[1]);
    if (n != null && n >= 5 && n <= 30000) oilVolumeLitres = hit(n, "medium", inline![0]);
  }
  const oilWtRow = numberForLabel(upperLines, /OIL\s*(?:WEIGHT|MASS)|MASS\s*OF\s*OIL|WEIGHT\s*OF\s*OIL/, {
    min: 5,
    max: 30000,
    lookahead: 1,
  });
  if (oilWtRow) oilWeightKgNoted = Math.round(oilWtRow.value);

  let totalWeightKg = none<number>();
  const wtRow = numberForLabel(upperLines, /TOTAL\s*(?:WEIGHT|MASS)|GROSS\s*(?:WEIGHT|MASS)/, {
    min: 50,
    max: 200000,
    lookahead: 1,
  });
  if (wtRow) totalWeightKg = hit(Math.round(wtRow.value), "high", wtRow.source);
  else {
    const inline = upper.match(/(\d{2,6})\s*KGS?\b/);
    const n = toNumber(inline?.[1]);
    if (n != null && n >= 50 && n <= 200000) totalWeightKg = hit(n, "medium", inline![0]);
  }

  let manufacturerGuess = none<string>();
  for (const maker of MAKERS) {
    const p = maker.patterns.find((r) => r.test(upper));
    if (p) {
      manufacturerGuess = hit(maker.name, p === maker.patterns[0] ? "high" : "medium", maker.name);
      break;
    }
  }

  const fields = [
    serialNumber, ratingKva, primaryKv, secondaryKv, yearOfManufacture, frequencyHz,
    coolingType, vectorGroup, impedancePct, oilVolumeLitres, totalWeightKg, manufacturerGuess,
  ];

  return {
    serialNumber, ratingKva, primaryKv, secondaryKv, yearOfManufacture, frequencyHz,
    coolingType, vectorGroup, impedancePct, oilVolumeLitres, totalWeightKg, manufacturerGuess,
    oilWeightKgNoted,
    matchedCount: fields.filter((f) => f.value != null).length,
    totalFields: fields.length,
  };
}
