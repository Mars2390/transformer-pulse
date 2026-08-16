import { z } from "zod";

/**
 * Reading a nameplate with a vision model, without letting it invent anything.
 *
 * A vision-language model solves the problem Tesseract could not: it does
 * LAYOUT understanding, so "Rating (KVA) … 3500" in a two-column table is read
 * as one row rather than as two unrelated fragments. That is a genuine step
 * change and it is why this path exists.
 *
 * It also introduces a failure mode Tesseract never had. Tesseract's mistakes
 * look like mistakes — "3S00", "0NAN". A model's mistakes look like ANSWERS. It
 * will read a blank Impedance row and return 4.5, because 4.5 is what a
 * transformer's impedance usually is, and it will sound just as certain about
 * that as about the serial it actually read. That is precisely the bug we spent
 * a release removing from the regex parser, arriving by a more persuasive route.
 *
 * So everything here is built to make refusal easy and invention hard:
 *
 *   - the prompt demands null for anything not literally visible,
 *   - the model must return the exact text it read for each field, so a human
 *     can check the machine's work against the photograph,
 *   - every value is range-checked in code afterwards, and a value outside
 *     plausible bounds is dropped rather than shown,
 *   - nothing is auto-saved. Every field lands in a form a person confirms.
 */

/** What we ask the model for. Mirrors the columns that exist on Transformer. */
export const AI_FIELDS = [
  "serialNumber",
  "manufacturer",
  "ratingKva",
  "primaryKv",
  "secondaryKv",
  "yearOfManufacture",
  "phases",
  "coolingType",
  "impedancePct",
  "vectorGroup",
  "oilVolumeLitres",
  "frequencyHz",
  "duty",
  "standardRef",
  "bilKv",
  "tempRiseOilC",
  "tempRiseWindingC",
  "tempClass",
  "maxAmbientC",
  "oilType",
  "oilWeightKg",
  "totalWeightKg",
  "tapRange",
] as const;

export type AiFieldKey = (typeof AI_FIELDS)[number];

/**
 * One reading: the value, and the characters on the plate it came from.
 *
 * `seenAs` is the important half. A number on its own is a claim; a number next
 * to the text it was read from is evidence somebody can check in two seconds.
 */
const reading = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  seenAs: z.string().nullable().optional(),
});

export const aiNameplateSchema = z.object({
  fields: z.record(z.string(), reading),
  rawText: z.string().optional().default(""),
  unreadable: z.boolean().optional().default(false),
});

export const NAMEPLATE_PROMPT = `You are reading the rating plate of a distribution transformer for an electricity utility. The photograph may be angled, dirty, corroded, glared, or a picture of a screen.

Return ONE JSON object and nothing else:

{
  "rawText": "every line of text you can read on the plate, in order",
  "unreadable": false,
  "fields": {
    "<fieldName>": { "value": <value or null>, "seenAs": "<the exact characters on the plate>" }
  }
}

Fields: ${AI_FIELDS.join(", ")}

RULES — these matter more than completeness:

1. If a field is not printed on the plate, or its row is BLANK, or you cannot read it clearly, return {"value": null, "seenAs": null}. A null is a correct answer. A plausible guess is a WRONG answer that a human will approve without checking, and it will end up on an asset register.
2. NEVER infer a value from what transformers usually have. If the impedance row is empty, impedance is null — do not return 4.5 because that is typical.
3. "seenAs" must be the literal characters you saw. If you cannot quote it, the value must be null.
4. Many plates are two-column tables where the unit is in the label and the number is in a separate column: "Rating (KVA)    3500" means ratingKva 3500. Read across the row.
5. Voltages: return kV. A plate showing 11000/433 volts means primaryKv 11 and secondaryKv 0.433.
6. Oil: oilVolumeLitres ONLY if the plate gives a volume in litres. If it gives a weight in kg, put it in oilWeightKg and leave oilVolumeLitres null. They are different quantities.
7. Numbers as numbers, not strings. Text fields (coolingType, vectorGroup, duty, standardRef, tempClass, oilType, tapRange, manufacturer, serialNumber) as strings.
8. If the image is not a transformer nameplate at all, set "unreadable": true and return every field null.`;

/**
 * Plausibility bounds. A model that returns 35000 kVA for a pole-mounted unit
 * has misread a tapping table, and showing that to a store keeper is worse than
 * showing nothing.
 */
const BOUNDS: Partial<Record<AiFieldKey, { min: number; max: number }>> = {
  ratingKva: { min: 5, max: 20000 },
  primaryKv: { min: 0.1, max: 400 },
  secondaryKv: { min: 0.1, max: 400 },
  yearOfManufacture: { min: 1950, max: new Date().getFullYear() },
  phases: { min: 1, max: 3 },
  impedancePct: { min: 0.5, max: 25 },
  oilVolumeLitres: { min: 5, max: 30000 },
  frequencyHz: { min: 45, max: 65 },
  bilKv: { min: 10, max: 1500 },
  tempRiseOilC: { min: 20, max: 120 },
  tempRiseWindingC: { min: 20, max: 150 },
  maxAmbientC: { min: 10, max: 70 },
  oilWeightKg: { min: 5, max: 30000 },
  totalWeightKg: { min: 20, max: 200000 },
};

export type Confidence = "high" | "medium" | "low";

export type AiField = {
  value: string | number | null;
  seenAs: string | null;
  confidence: Confidence;
  /** Set when a value was returned but thrown away, so the reason is visible. */
  rejected: string | null;
};

export type AiNameplateResult = {
  fields: Record<string, AiField>;
  rawText: string;
  unreadable: boolean;
  readCount: number;
  rejectedCount: number;
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const TEXT_FIELDS = new Set<string>([
  "serialNumber", "manufacturer", "coolingType", "vectorGroup",
  "duty", "standardRef", "tempClass", "oilType", "tapRange",
]);

/**
 * Turn the model's answer into something safe to put in front of a person.
 *
 * Confidence is derived, not asked for. A model asked to rate its own certainty
 * will say "high" about a hallucination — the useful signal is whether it could
 * quote the characters it read, which is a fact about its output rather than an
 * opinion about it.
 */
export function normaliseAiResult(parsed: z.infer<typeof aiNameplateSchema>): AiNameplateResult {
  const out: Record<string, AiField> = {};
  let readCount = 0;
  let rejectedCount = 0;

  for (const key of AI_FIELDS) {
    const raw = parsed.fields?.[key];
    const seenAs = raw?.seenAs?.trim() || null;
    let value: string | number | null = null;
    let rejected: string | null = null;

    if (raw && raw.value !== null && raw.value !== undefined && raw.value !== "") {
      if (TEXT_FIELDS.has(key)) {
        const t = String(raw.value).trim();
        value = t.length > 0 && t.length <= 60 ? t : null;
        if (value === null) rejected = "Text was empty or implausibly long.";
      } else {
        const n = toNumber(raw.value);
        const b = BOUNDS[key];
        if (n === null) {
          rejected = "Not a number.";
        } else if (b && (n < b.min || n > b.max)) {
          rejected = `${n} is outside the plausible range ${b.min}–${b.max}, so it was dropped.`;
        } else {
          value = n;
        }
      }
    }

    // No quote, no confidence. A value the model cannot point at on the plate is
    // the signature of an invented one.
    const confidence: Confidence = value === null ? "low" : seenAs ? "high" : "medium";

    if (value !== null) readCount++;
    if (rejected) rejectedCount++;

    out[key] = { value, seenAs, confidence, rejected };
  }

  return {
    fields: out,
    rawText: parsed.rawText ?? "",
    unreadable: Boolean(parsed.unreadable),
    readCount,
    rejectedCount,
  };
}

/** Pull the first JSON object out of a reply that may be wrapped in prose or fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
