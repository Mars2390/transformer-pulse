"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { resizeImage } from "@/lib/imageResize";
import { prepareForOcr } from "@/lib/imagePrep";
import { parseNameplate } from "@/lib/nameplate-parse";

/**
 * Photograph a nameplate, read it with Tesseract.js entirely in the browser,
 * and hand back a best guess at every field it could find — each one tagged
 * with how sure it is.
 *
 * The OCR is a HELPER, not an authority. Nothing here is ever saved without
 * the engineer confirming it on the review screen, and every field on that
 * screen stays a plain editable input — a rusty plate is common, and
 * pretending the machine read it perfectly would be worse than not reading
 * it at all.
 *
 * Tesseract.js runs client-side (fetching its worker/wasm/trained-data from
 * its own CDN the first time, same as any other browser library) — no
 * server round trip, no per-scan API cost.
 */

type Confidence = "high" | "medium" | "low";

export type OcrFieldValue<T> = { value: T; confidence: Confidence };

export type NameplateExtraction = {
  serialNumber: OcrFieldValue<string | null>;
  manufacturerId: OcrFieldValue<string | null>;
  manufacturerLabel: OcrFieldValue<string | null>;
  ratingKva: OcrFieldValue<number | null>;
  primaryKv: OcrFieldValue<number | null>;
  secondaryKv: OcrFieldValue<number | null>;
  yearOfManufacture: OcrFieldValue<number | null>;
  frequencyHz: OcrFieldValue<number | null>;
  coolingType: OcrFieldValue<string | null>;
  oilVolumeLitres: OcrFieldValue<number | null>;
  totalWeightKg: OcrFieldValue<number | null>;
  vectorGroup: OcrFieldValue<string | null>;
  impedancePct: OcrFieldValue<number | null>;
};

export type ConfirmedNameplateData = {
  photoUrl: string;
  serialNumber: string | null;
  manufacturerId: string | null;
  ratingKva: number | null;
  primaryKv: number | null;
  secondaryKv: number | null;
  yearOfManufacture: number | null;
  frequencyHz: number | null;
  coolingType: string | null;
  oilVolumeLitres: number | null;
  totalWeightKg: number | null;
  vectorGroup: string | null;
  impedancePct: number | null;
};

// A starting list of common manufacturers seen on KPLC nameplates, tried
// alongside whatever is actually in the manufacturer dropdown — a plate can
// legibly say "ABB" for a manufacturer that isn't in the register yet, and
// that is still worth surfacing to the engineer even if it can't be matched
// to an id.
const KNOWN_MANUFACTURER_NAMES = [
  "TELK", "ABB", "PANFRICA", "SIEMENS", "CSEPEL", "BRYCEE", "P.E", "TOSHIBA",
  "TANELEC", "SANBIAN", "TBEA", "HITACHI", "SCHNEIDER", "GE", "WESTINGHOUSE",
];

function normaliseOcrText(raw: string): string {
  return raw.replace(/\r/g, "").replace(/[ \t]+/g, " ");
}

function matchNumber(text: string, pattern: RegExp): number | null {
  const m = text.match(pattern);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** The actual field extraction — plain regex over the raw OCR text. */
function extractFields(rawText: string, manufacturers: { id: string; name: string }[]): NameplateExtraction {
  const text = normaliseOcrText(rawText);
  const upper = text.toUpperCase();

  let serialNumber: OcrFieldValue<string | null> = { value: null, confidence: "low" };
  const serialLabelled = text.match(/(?:SERIAL(?:\s*NO\.?)?|S[\/.]?N[o°]?)\s*[:\-.]?\s*([A-Z0-9][A-Z0-9\-\/]{3,19})/i);
  if (serialLabelled) {
    serialNumber = { value: serialLabelled[1].toUpperCase(), confidence: "high" };
  } else {
    // Unlabelled fallback: a lone alphanumeric token that looks serial-shaped
    // (mixes letters and digits, 5-20 chars) is worth offering, but flagged
    // low confidence since it could be anything else printed on the plate.
    const loose = text.match(/\b(?=[A-Z0-9\-]{5,20}\b)(?=[A-Z0-9\-]*\d)(?=[A-Z0-9\-]*[A-Z])[A-Z0-9\-]{5,20}\b/i);
    if (loose) serialNumber = { value: loose[0].toUpperCase(), confidence: "low" };
  }

  let manufacturerId: OcrFieldValue<string | null> = { value: null, confidence: "low" };
  let manufacturerLabel: OcrFieldValue<string | null> = { value: null, confidence: "low" };
  for (const m of manufacturers) {
    if (upper.includes(m.name.toUpperCase())) {
      manufacturerId = { value: m.id, confidence: "high" };
      manufacturerLabel = { value: m.name, confidence: "high" };
      break;
    }
  }
  if (!manufacturerLabel.value) {
    for (const name of KNOWN_MANUFACTURER_NAMES) {
      if (upper.includes(name)) {
        manufacturerLabel = { value: name, confidence: "medium" };
        break;
      }
    }
  }

  let ratingKva: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const kva = matchNumber(text, /(\d{1,5}(?:[.,]\d+)?)\s*[-]?\s*k\s?VA\b/i);
  if (kva != null) {
    ratingKva = { value: Math.round(kva), confidence: "high" };
  } else {
    const mva = matchNumber(text, /(\d{1,3}(?:[.,]\d+)?)\s*[-]?\s*M\s?VA\b/i);
    if (mva != null) ratingKva = { value: Math.round(mva * 1000), confidence: "medium" };
  }

  let primaryKv: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  let secondaryKv: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const voltage = text.match(/(\d{2,6}(?:\.\d+)?)\s*\/\s*(\d{2,6}(?:\.\d+)?)\s*(?:k\s?V|VOLTS?|V)?\b/i);
  if (voltage) {
    let p = Number(voltage[1]);
    let s = Number(voltage[2]);
    // A plate in raw volts ("11000/433") reads the same shape as one already
    // in kV ("11/0.433") — over 1000 means volts, so bring both to kV.
    if (p > 1000) p = p / 1000;
    if (s > 100) s = s / 1000;
    if (Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0) {
      primaryKv = { value: Math.round(p * 1000) / 1000, confidence: "high" };
      secondaryKv = { value: Math.round(s * 1000) / 1000, confidence: "high" };
    }
  }

  let yearOfManufacture: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const labelledYear = text.match(/(?:YOM|YEAR(?:\s*OF\s*MANUFACTURE)?|MFG(?:\s*DATE)?)\s*[:\-.]?\s*(19|20)(\d{2})/i);
  if (labelledYear) {
    yearOfManufacture = { value: Number(labelledYear[1] + labelledYear[2]), confidence: "high" };
  } else {
    const bareYear = text.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    if (bareYear) yearOfManufacture = { value: Number(bareYear[1]), confidence: "medium" };
  }

  let frequencyHz: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const freq = matchNumber(text, /\b(50|60)\s*Hz\b/i);
  if (freq != null) frequencyHz = { value: freq, confidence: "high" };

  let coolingType: OcrFieldValue<string | null> = { value: null, confidence: "low" };
  const cooling = upper.match(/\b(ONAN|ONAF|OFAF|OFAN|KNAN|KNAF|AN|AF)\b/);
  if (cooling) coolingType = { value: cooling[1], confidence: "high" };

  let oilVolumeLitres: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const oil = matchNumber(text, /(\d{2,6})\s*(?:LITRES?|LITERS?|L)\b(?!\w)/i);
  if (oil != null) oilVolumeLitres = { value: Math.round(oil), confidence: "medium" };

  let totalWeightKg: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const weight = matchNumber(text, /(\d{2,6})\s*(?:KGS?|KG)\b/i);
  if (weight != null) totalWeightKg = { value: Math.round(weight), confidence: "medium" };

  let vectorGroup: OcrFieldValue<string | null> = { value: null, confidence: "low" };
  const vector = text.match(/\b(D\s?yn\s?\d{1,2}|Y\s?yn\s?\d{1,2}|Y\s?zn\s?\d{1,2}|D\s?d\s?\d{1,2}|Y\s?y\s?\d{1,2})\b/i);
  if (vector) vectorGroup = { value: vector[1].replace(/\s+/g, ""), confidence: "high" };

  let impedancePct: OcrFieldValue<number | null> = { value: null, confidence: "low" };
  const imp = matchNumber(text, /(\d{1,2}(?:\.\d+)?)\s*%/);
  if (imp != null && imp <= 30) impedancePct = { value: imp, confidence: "medium" };

  return {
    serialNumber, manufacturerId, manufacturerLabel, ratingKva, primaryKv, secondaryKv,
    yearOfManufacture, frequencyHz, coolingType, oilVolumeLitres, totalWeightKg,
    vectorGroup, impedancePct,
  };
}

const CONFIDENCE_META: Record<Confidence, { icon: string; label: string }> = {
  high: { icon: "🟢", label: "High confidence" },
  medium: { icon: "🟡", label: "Review recommended" },
  low: { icon: "🔴", label: "Not found — enter manually" },
};

/**
 * Map the pure parser's output onto the shape this component already renders.
 *
 * Keeping parseNameplate() free of React and of the manufacturer list is what
 * makes it testable against real plate text — see the label-anchored reasoning
 * in src/lib/nameplate-parse.ts. This function is the only glue.
 */
function toLegacyShape(
  parsed: ReturnType<typeof parseNameplate>,
  manufacturers: { id: string; name: string }[],
): NameplateExtraction {
  const guess = parsed.manufacturerGuess.value;
  const matched = guess
    ? manufacturers.find((m) => m.name.toUpperCase().includes(guess.toUpperCase()))
    : undefined;

  return {
    serialNumber: parsed.serialNumber,
    manufacturerId: matched
      ? { value: matched.id, confidence: parsed.manufacturerGuess.confidence }
      : { value: null, confidence: "low" as const },
    // What the plate said, kept even when no configured manufacturer matches —
    // "ABB" read off the plate is useful to the keeper even if ABB has not been
    // added to the system yet.
    manufacturerLabel: {
      value: matched?.name ?? guess ?? null,
      confidence: matched ? parsed.manufacturerGuess.confidence : ("low" as const),
    },
    ratingKva: parsed.ratingKva,
    primaryKv: parsed.primaryKv,
    secondaryKv: parsed.secondaryKv,
    yearOfManufacture: parsed.yearOfManufacture,
    frequencyHz: parsed.frequencyHz,
    coolingType: parsed.coolingType,
    oilVolumeLitres: parsed.oilVolumeLitres,
    totalWeightKg: parsed.totalWeightKg,
    vectorGroup: parsed.vectorGroup,
    impedancePct: parsed.impedancePct,
  } as NameplateExtraction;
}

type Stage = "idle" | "resizing" | "reading" | "review" | "uploading";

export function NameplateOCR({
  manufacturers,
  onConfirm,
  onFillManually,
}: {
  manufacturers: { id: string; name: string }[];
  onConfirm: (data: ConfirmedNameplateData) => void;
  onFillManually: () => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<NameplateExtraction | null>(null);
  const [rawText, setRawText] = useState("");
  const [showRawText, setShowRawText] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable review-screen state, seeded from the extraction but independent
  // of it from that point on — the engineer's corrections are what get saved.
  const [form, setForm] = useState<ConfirmedNameplateData | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setStage("resizing");

    try {
      // Two different images from one photo. The upload copy is shrunk so it
      // will actually finish over LTE; the OCR copy is upscaled, greyscaled and
      // contrast-stretched, because Tesseract reads engraved text better the
      // more pixels it has. Handing the shrunk copy to OCR was a large part of
      // why the scanner read almost nothing.
      const resized = await resizeImage(file);
      setPhoto(resized);
      setStage("reading");
      setProgress(0);
      const forOcr = await prepareForOcr(file);

      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", undefined, {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const { data } = await worker.recognize(forOcr);
      await worker.terminate();

      const text = data.text ?? "";
      setRawText(text);
      const parsed = parseNameplate(text);
      const extracted = toLegacyShape(parsed, manufacturers);
      setExtraction(extracted);
      setForm({
        photoUrl: "",
        serialNumber: extracted.serialNumber.value,
        manufacturerId: extracted.manufacturerId.value,
        ratingKva: extracted.ratingKva.value,
        primaryKv: extracted.primaryKv.value,
        secondaryKv: extracted.secondaryKv.value,
        yearOfManufacture: extracted.yearOfManufacture.value,
        frequencyHz: extracted.frequencyHz.value,
        coolingType: extracted.coolingType.value,
        oilVolumeLitres: extracted.oilVolumeLitres.value,
        totalWeightKg: extracted.totalWeightKg.value,
        vectorGroup: extracted.vectorGroup.value,
        impedancePct: extracted.impedancePct.value,
      });
      setStage("review");
    } catch {
      setError("Reading the nameplate failed. You can retry, or fill the form in by hand — nothing has been lost.");
      setStage("idle");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function rescan() {
    setStage("idle");
    setExtraction(null);
    setForm(null);
    setPhoto(null);
    setPhotoPreview(null);
    setError(null);
  }

  async function confirmAndSave() {
    if (!photo || !form) return;
    setStage("uploading");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", photo);
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload failed.");

      onConfirm({ ...form, photoUrl: data.url });
    } catch (err) {
      setError((err as Error).message);
      setStage("review");
    }
  }

  if (stage === "idle") {
    return (
      <div className="rounded-2xl border border-line bg-white p-5">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">{error}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-xl bg-kplc px-5 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
          >
            📸 Scan Nameplate
          </button>
          <button
            type="button"
            onClick={onFillManually}
            className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy transition-colors hover:border-navy/30"
          >
            Fill Manually
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Photograph the rating plate and the fields below are read automatically — you still confirm
          everything before it saves.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="hidden"
        />
      </div>
    );
  }

  if (stage === "resizing" || stage === "reading") {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        {photoPreview && (
          <div className="relative mx-auto mb-4 h-40 w-40 overflow-hidden rounded-xl border border-line">
            <Image src={photoPreview} alt="" fill className="object-cover" unoptimized />
          </div>
        )}
        <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-kplc border-t-transparent" />
        <p className="mt-3 text-sm font-bold text-navy">
          {stage === "resizing" ? "Preparing photo…" : `Reading nameplate… ${progress}%`}
        </p>
        <p className="mt-1 text-xs text-ink-soft">Running entirely on this device — no data leaves it for this step.</p>
      </div>
    );
  }

  if (stage === "uploading") {
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-kplc border-t-transparent" />
        <p className="mt-3 text-sm font-bold text-navy">Saving photo…</p>
      </div>
    );
  }

  if (stage === "review" && extraction && form) {
    const set = <K extends keyof ConfirmedNameplateData>(key: K, value: ConfirmedNameplateData[K]) =>
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

    const rows: { key: keyof NameplateExtraction; label: string; unit?: string }[] = [
      { key: "serialNumber", label: "Serial number" },
      { key: "manufacturerLabel", label: "Manufacturer" },
      { key: "ratingKva", label: "Rating", unit: "kVA" },
      { key: "primaryKv", label: "Primary voltage", unit: "kV" },
      { key: "secondaryKv", label: "Secondary voltage", unit: "kV" },
      { key: "yearOfManufacture", label: "Year" },
      { key: "frequencyHz", label: "Frequency", unit: "Hz" },
      { key: "coolingType", label: "Cooling" },
      { key: "vectorGroup", label: "Vector group" },
      { key: "impedancePct", label: "Impedance", unit: "%" },
      { key: "oilVolumeLitres", label: "Oil volume", unit: "L" },
      { key: "totalWeightKg", label: "Total weight", unit: "kg" },
    ];

    return (
      <div className="rounded-2xl border border-line bg-white p-5">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">{error}</p>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          {/* --- Photo, zoomable --- */}
          <div>
            <p className="text-xs font-bold text-navy">Nameplate photo</p>
            {photoPreview && (
              <a href={photoPreview} target="_blank" rel="noopener noreferrer" className="mt-2 block">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-surface-2">
                  <Image src={photoPreview} alt="Photographed nameplate" fill className="object-contain" unoptimized />
                </div>
                <p className="mt-1 text-[11px] text-ink-soft">Tap to view full size</p>
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowRawText((v) => !v)}
              className="mt-3 text-[11px] font-bold text-ink-soft underline decoration-dotted hover:text-navy"
            >
              {showRawText ? "Hide" : "Show"} raw text Tesseract read
            </button>
            {showRawText && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[10px] text-ink-soft">
                {rawText || "(nothing legible)"}
              </pre>
            )}
          </div>

          {/* --- Extracted fields, editable --- */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-navy">Extracted details — review and correct</p>
            {rows.map((row) => {
              const field = extraction[row.key];
              const meta = CONFIDENCE_META[field.confidence];
              return (
                <div key={row.key} className="flex items-center gap-2">
                  <span title={meta.label} className="w-5 shrink-0 text-center">{meta.icon}</span>
                  <label className="w-32 shrink-0 text-[11px] font-semibold text-ink-soft">{row.label}</label>
                  {row.key === "manufacturerLabel" ? (
                    <select
                      value={form.manufacturerId ?? ""}
                      onChange={(e) => set("manufacturerId", e.target.value || null)}
                      className="flex-1 rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none focus:border-kplc"
                    >
                      <option value="">
                        {extraction.manufacturerLabel.value ? `${extraction.manufacturerLabel.value} (not in register — choose one)` : "Choose manufacturer…"}
                      </option>
                      {manufacturers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="relative flex-1">
                      <input
                        value={String((form as unknown as Record<string, string | number | null>)[row.key] ?? "")}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const isNumeric = typeof field.value === "number" || field.value === null && row.key !== "serialNumber" && row.key !== "coolingType" && row.key !== "vectorGroup";
                          set(row.key as keyof ConfirmedNameplateData, (isNumeric ? (raw === "" ? null : Number(raw)) : raw) as never);
                        }}
                        className={`w-full rounded-lg border border-line px-2.5 py-1.5 text-xs outline-none focus:border-kplc ${row.unit ? "pr-10" : ""}`}
                      />
                      {row.unit && (
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-ink-soft">
                          {row.unit}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={confirmAndSave}
            className="rounded-xl bg-kplc px-5 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
          >
            ✓ Confirm &amp; Save
          </button>
          <button
            type="button"
            onClick={rescan}
            className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy transition-colors hover:border-navy/30"
          >
            Re-scan
          </button>
          <button
            type="button"
            onClick={onFillManually}
            className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy transition-colors hover:border-navy/30"
          >
            Fill Manually Instead
          </button>
        </div>
      </div>
    );
  }

  return null;
}
