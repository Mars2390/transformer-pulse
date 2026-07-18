import ExcelJS from "exceljs";
import { KENYA_BOUNDS } from "./geo";

/**
 * Bulk-import parsing and normalisation.
 *
 * The hard part of importing KPLC's existing spreadsheets is not reading the
 * file — it is that every office writes the same fact differently. "In Field",
 * "in_field", "Installed"; "1°17'31.6\"S" and "-1.292100"; "05/03/2021" and
 * "2021-03-05". This module turns all of that into one clean shape, and refuses
 * anything it cannot honestly interpret.
 */

// --- File reading -----------------------------------------------------------

/**
 * A CSV parser that respects quotes.
 *
 * Hand-rolled rather than pulled from a package: a site name containing a comma
 * ("Kabete, Nairobi") must not split into two columns, and that is the whole
 * requirement. Handles "" escapes and both CRLF and LF.
 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, ""); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  // A double-quote only opens a quoted field at the START of a field. This is
  // not pedantry: a GPS value written as 1°17'31.6"S contains a quote, and
  // treating that as a delimiter swallows the rest of the line and silently
  // shifts every column after it.
  let atFieldStart = true;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
      continue;
    }

    if (ch === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; continue; }
    if (ch === ",") { row.push(cell); cell = ""; atFieldStart = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; atFieldStart = true; continue; }
    cell += ch;
    atFieldStart = false;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values: string[] = [];
    // ExcelJS row.values is 1-indexed with a leading hole.
    const raw = row.values as unknown[];
    for (let i = 1; i < raw.length; i++) {
      const v = raw[i];
      if (v == null) { values.push(""); continue; }
      // Full ISO, not just the date. Meter readings are timestamps — truncating
      // to the day would collapse all 96 intervals onto one.
      if (v instanceof Date) { values.push(v.toISOString()); continue; }
      if (typeof v === "object" && v !== null && "text" in v) {
        values.push(String((v as { text: unknown }).text ?? "")); continue;
      }
      if (typeof v === "object" && v !== null && "result" in v) {
        values.push(String((v as { result: unknown }).result ?? "")); continue;
      }
      values.push(String(v));
    }
    rows.push(values);
  });
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// --- Header detection -------------------------------------------------------

/** Every field we can import, with the header spellings we accept for it. */
export const FIELD_ALIASES: Record<string, string[]> = {
  serialNumber: ["serial number", "serial no", "serial", "sn", "serialno", "manufacturer serial"],
  gNumber: ["g-number", "g number", "gnumber", "g no", "kplc number", "asset number"],
  manufacturerName: ["manufacturer", "make", "maker", "brand", "manufacturer name"],
  ratingKva: ["rating (kva)", "rating kva", "rating", "kva", "capacity", "size", "size (kva)"],
  status: ["status", "state", "condition"],
  primaryKv: ["primary voltage (kv)", "primary voltage", "primary kv", "hv kv", "hv voltage", "primary"],
  secondaryKv: ["secondary voltage (kv)", "secondary voltage", "secondary kv", "lv kv", "lv voltage", "secondary"],
  yearOfManufacture: ["year of manufacture", "year", "manufacture year", "yom", "manufacturing date"],
  locationDescription: ["location description", "location", "site", "site name", "area", "place"],
  latitude: ["gps latitude", "latitude", "lat", "y"],
  longitude: ["gps longitude", "longitude", "long", "lng", "lon", "x"],
  gpsCombined: ["gps", "coordinates", "gps coordinates", "latlong", "lat/long", "lat long"],
  region: ["region", "area office", "zone"],
  storeName: ["store", "store name", "warehouse", "depot"],
  installationDate: ["installation date", "install date", "date installed", "commissioned", "commission date", "date of installation"],
  oilBdvKv: ["oil bdv (kv)", "oil bdv", "bdv", "bdv (kv)", "oil breakdown voltage"],
  irHv: ["ir hv-earth (mω)", "ir hv-earth", "ir hv", "insulation resistance hv", "megger hv"],
  irLv: ["ir lv-earth (mω)", "ir lv-earth", "ir lv", "insulation resistance lv", "megger lv"],
  phases: ["phases", "phase", "no of phases"],
  coolingType: ["cooling type", "cooling", "cooling method"],
  impedancePct: ["impedance %", "impedance", "impedance percent", "z%"],
  vectorGroup: ["vector group", "vector", "connection group"],
  oilVolumeLitres: ["oil litres", "oil volume", "oil volume (litres)", "oil (l)"],
  frequencyHz: ["frequency (hz)", "frequency", "hz"],
  duty: ["duty"],
  standardRef: ["standard", "standard ref", "specification"],
  hvInsulationLevelKv: ["hv insulation level", "hv insulation level / bil", "bil", "insulation level"],
  tempRiseOilC: ["oil temp rise", "oil temperature rise", "top oil rise"],
  tempRiseWindingC: ["winding temp rise", "winding temperature rise"],
  tempClass: ["temp class", "temperature class", "insulation class"],
  maxAmbientTempC: ["max ambient", "max ambient temp", "maximum ambient temperature"],
  insulationOilType: ["insulation oil type", "oil type", "type of insulation oil"],
  oilWeightKg: ["oil weight (kg)", "oil weight", "oil mass"],
  totalWeightKg: ["total weight (kg)", "total weight", "gross weight", "weight"],
  tapRange: ["tap range", "taps", "tap positions", "tap changer"],
  deliveryNoteRef: ["delivery note reference", "delivery note", "dn ref", "grn"],
  vehiclePlate: ["vehicle plate", "number plate", "vehicle", "plate"],
  driverName: ["driver name", "driver"],
  driverPhone: ["driver phone", "driver contact", "driver number"],
  lastInspectionDate: ["last inspection date", "last inspection", "last inspected"],
};

const normaliseHeader = (h: string) =>
  h.toLowerCase().trim().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").replace(/[.:]/g, "");

export type HeaderMap = { index: Record<string, number>; unmapped: string[] };

/**
 * Maps a file's header row onto our fields.
 *
 * Alias matching first, then a loose contains-match, so a column called
 * "Transformer Serial Number (from plate)" still lands on serialNumber. This is
 * what lets KPLC upload their existing sheet without reformatting it.
 */
export function detectHeaders(headerRow: string[]): HeaderMap {
  const index: Record<string, number> = {};
  const unmapped: string[] = [];

  headerRow.forEach((raw, i) => {
    const h = normaliseHeader(raw);
    if (!h) return;

    let matched: string | null = null;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(h)) { matched = field; break; }
    }
    if (!matched) {
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.some((a) => h.includes(a) || a.includes(h))) { matched = field; break; }
      }
    }
    if (matched && !(matched in index)) index[matched] = i;
    else if (!matched) unmapped.push(raw.trim());
  });

  return { index, unmapped };
}

// --- Value normalisation ----------------------------------------------------

/**
 * GPS in any of the shapes a Kenyan utility spreadsheet uses.
 * Accepts decimal (-1.2921), DMS (1°17'31.6"S) and comma pairs.
 */
export function parseCoordinate(raw: string, axis: "lat" | "lng"): number | null {
  const text = raw.trim();
  if (!text) return null;

  // Degrees / minutes / seconds, e.g. 1°17'31.6"S
  const dms = text.match(/(\d+(?:\.\d+)?)\s*[°d]\s*(\d+(?:\.\d+)?)?\s*['′m]?\s*(\d+(?:\.\d+)?)?\s*["″s]?\s*([NSEW])?/i);
  if (dms && (dms[2] != null || dms[4] != null)) {
    const deg = Number(dms[1]);
    const min = Number(dms[2] ?? 0);
    const sec = Number(dms[3] ?? 0);
    let value = deg + min / 60 + sec / 3600;
    const hemi = dms[4]?.toUpperCase();
    if (hemi === "S" || hemi === "W") value = -value;
    return Number.isFinite(value) ? value : null;
  }

  const n = Number(text.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return null;
  // A trailing S/W on an otherwise decimal value still means negative.
  return /[SW]\s*$/i.test(text) && n > 0 ? -n : n;
}

/** Splits "-1.2921, 36.8219" into a pair. */
export function parseCoordinatePair(raw: string): { lat: number; lng: number } | null {
  const parts = raw.split(/[,;|]/);
  if (parts.length < 2) return null;
  const lat = parseCoordinate(parts[0], "lat");
  const lng = parseCoordinate(parts[1], "lng");
  return lat != null && lng != null ? { lat, lng } : null;
}

export function coordinatesInKenya(lat: number, lng: number): boolean {
  if (lat === 0 && lng === 0) return false; // Null Island
  return (
    lat >= KENYA_BOUNDS.minLat && lat <= KENYA_BOUNDS.maxLat &&
    lng >= KENYA_BOUNDS.minLng && lng <= KENYA_BOUNDS.maxLng
  );
}

/**
 * Dates in the formats a KPLC sheet actually contains.
 * DD/MM/YYYY is assumed for ambiguous slash dates — Kenyan convention — and
 * the caller is warned when the value could also read as US order.
 */
export function parseImportDate(raw: string): { date: Date | null; ambiguous: boolean } {
  const text = raw.trim();
  if (!text) return { date: null, ambiguous: false };

  // Excel serial number (days since 1899-12-30).
  if (/^\d{5}$/.test(text)) {
    const serial = Number(text);
    return { date: new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000), ambiguous: false };
  }

  // Dates are built at UTC midnight, not local midnight. A date built locally
  // in Nairobi (UTC+3) serialises as the PREVIOUS day in UTC, so an install
  // date of 15 June would store and export as 14 June.
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

  // ISO YYYY-MM-DD
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const d = utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return { date: isNaN(d.getTime()) ? null : d, ambiguous: false };
  }

  // DD/MM/YYYY or D/M/YY
  const dmy = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmy) {
    const a = Number(dmy[1]); const b = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    // If the first part cannot be a day, it must be a month (US order).
    const usOrder = a > 12 ? false : b > 12;
    const day = usOrder ? b : a;
    const month = usOrder ? a : b;
    const d = utc(year, month - 1, day);
    return { date: isNaN(d.getTime()) ? null : d, ambiguous: !usOrder && a <= 12 && b <= 12 };
  }

  // Bare year — common in "Manufacturing date: 2007".
  if (/^\d{4}$/.test(text)) return { date: utc(Number(text), 0, 1), ambiguous: false };

  const loose = new Date(text);
  return { date: isNaN(loose.getTime()) ? null : loose, ambiguous: false };
}

const STATUS_WORDS: Record<string, string> = {
  in_field: "IN_FIELD", infield: "IN_FIELD", field: "IN_FIELD", installed: "IN_FIELD",
  live: "IN_FIELD", energised: "IN_FIELD", energized: "IN_FIELD", commissioned: "IN_FIELD",
  in_store: "IN_STORE", instore: "IN_STORE", store: "IN_STORE", warehouse: "IN_STORE",
  stock: "IN_STORE", spare: "IN_STORE", depot: "IN_STORE",
  in_transit: "IN_TRANSIT", intransit: "IN_TRANSIT", transit: "IN_TRANSIT", dispatched: "IN_TRANSIT",
  returned: "RETURNED", return: "RETURNED", scrapped: "RETURNED", written_off: "RETURNED",
  faulty: "FAULTY", fault: "FAULTY", failed: "FAULTY", damaged: "FAULTY", defective: "FAULTY",
};

export function normaliseStatus(raw: string): string | null {
  const key = raw.toLowerCase().trim().replace(/[\s\-]+/g, "_");
  if (!key) return null;
  if (STATUS_WORDS[key]) return STATUS_WORDS[key];
  const bare = key.replace(/_/g, "");
  return STATUS_WORDS[bare] ?? null;
}

/** Strips corporate noise so "ABB Kenya Ltd." and "ABB" compare equal. */
function manufacturerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|plc|inc|co|company|kenya|ke|east africa|group|electricals?|energy|international)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function matchManufacturer(
  raw: string,
  known: { id: string; name: string }[],
): { id: string; name: string } | null {
  const text = raw.trim();
  if (!text) return null;

  const exact = known.find((m) => m.name.toLowerCase() === text.toLowerCase());
  if (exact) return exact;

  const key = manufacturerKey(text);
  if (!key) return null;

  const keyed = known.find((m) => manufacturerKey(m.name) === key);
  if (keyed) return keyed;

  // One-way containment, longest match wins, so "TELK" finds "TELK Kenya".
  const partial = known
    .filter((m) => {
      const k = manufacturerKey(m.name);
      return k.length >= 3 && key.length >= 3 && (k.includes(key) || key.includes(k));
    })
    .sort((a, b) => manufacturerKey(b.name).length - manufacturerKey(a.name).length)[0];

  return partial ?? null;
}

export function toNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
