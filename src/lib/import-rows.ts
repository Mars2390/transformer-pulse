import {
  type HeaderMap, coordinatesInKenya, matchManufacturer, normaliseStatus,
  parseCoordinate, parseCoordinatePair, parseImportDate, toNumber,
} from "./import-parse";

/** Turns raw spreadsheet rows into validated, importable records. */

export type ImportLevel = "valid" | "warning" | "error";

export type ImportRowData = {
  serialNumber: string;
  gNumber: string | null;
  manufacturerId: string | null;
  manufacturerName: string;
  ratingKva: number | null;
  status: string;
  primaryKv: number | null;
  secondaryKv: number | null;
  yearOfManufacture: number | null;
  locationDescription: string | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
  storeId: string | null;
  installationDateISO: string | null;
  lastInspectionDateISO: string | null;
  oilBdvKv: number | null;
  irHv: number | null;
  irLv: number | null;
  phases: number | null;
  coolingType: string | null;
  impedancePct: number | null;
  vectorGroup: string | null;
  oilVolumeLitres: number | null;
  frequencyHz: number | null;
  duty: string | null;
  standardRef: string | null;
  hvInsulationLevelKv: string | null;
  tempRiseOilC: number | null;
  tempRiseWindingC: number | null;
  tempClass: string | null;
  maxAmbientTempC: number | null;
  insulationOilType: string | null;
  oilWeightKg: number | null;
  totalWeightKg: number | null;
  tapRange: string | null;
  deliveryNoteRef: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
};

export type ImportRow = {
  rowNumber: number;
  level: ImportLevel;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
  data: ImportRowData;
};

export type BuildContext = {
  headers: HeaderMap;
  manufacturers: { id: string; name: string }[];
  stores: { id: string; name: string; region: string }[];
  existingSerials: Set<string>;
  defaultRegion: string | null;
  defaultStoreId: string | null;
};

const VALID_STATUSES = ["IN_STORE", "IN_FIELD", "IN_TRANSIT", "RETURNED", "FAULTY"];

export function buildRows(
  dataRows: string[][],
  ctx: BuildContext,
  headerRowIndex: number,
): ImportRow[] {
  // Serials repeated WITHIN the file are as much a problem as ones already in
  // the database — catch them here rather than at the unique index.
  const seenInFile = new Set<string>();

  return dataRows.map((raw, i) => {
    const get = (field: string): string => {
      const idx = ctx.headers.index[field];
      return idx == null ? "" : String(raw[idx] ?? "").trim();
    };

    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = headerRowIndex + 2 + i; // 1-based, past the header

    // --- Required -----------------------------------------------------------
    const serialNumber = get("serialNumber").toUpperCase();
    if (!serialNumber) errors.push("Missing serial number");
    else if (serialNumber.length < 3) errors.push(`Serial number "${serialNumber}" is too short`);

    const manufacturerName = get("manufacturerName");
    const matched = manufacturerName ? matchManufacturer(manufacturerName, ctx.manufacturers) : null;
    if (!manufacturerName) errors.push("Missing manufacturer");
    else if (!matched) errors.push(`Manufacturer "${manufacturerName}" not recognised — add it first, or correct the spelling`);

    const ratingKva = toNumber(get("ratingKva"));
    if (ratingKva == null) errors.push("Missing rating (kVA)");
    else if (ratingKva <= 0 || ratingKva > 20_000) errors.push(`Rating ${ratingKva} kVA is out of range`);

    const rawStatus = get("status");
    let status = rawStatus ? normaliseStatus(rawStatus) : null;
    if (!rawStatus) { status = "IN_STORE"; warnings.push("No status given — defaulting to In store"); }
    else if (!status) errors.push(`Status "${rawStatus}" not recognised`);
    else if (!VALID_STATUSES.includes(status)) errors.push(`Status "${rawStatus}" not supported`);

    // --- Duplicates ---------------------------------------------------------
    let duplicate = false;
    if (serialNumber) {
      if (seenInFile.has(serialNumber)) {
        errors.push(`Serial number ${serialNumber} appears more than once in this file`);
      } else {
        seenInFile.add(serialNumber);
        if (ctx.existingSerials.has(serialNumber)) duplicate = true;
      }
    }

    // --- GPS ----------------------------------------------------------------
    let lat: number | null = null;
    let lng: number | null = null;
    const combined = get("gpsCombined");
    if (combined) {
      const pair = parseCoordinatePair(combined);
      if (pair) { lat = pair.lat; lng = pair.lng; }
      else errors.push(`Could not read GPS "${combined}"`);
    } else {
      const rawLat = get("latitude");
      const rawLng = get("longitude");
      if (rawLat || rawLng) {
        lat = parseCoordinate(rawLat, "lat");
        lng = parseCoordinate(rawLng, "lng");
        if (lat == null || lng == null) errors.push("Latitude and longitude must both be readable");
      }
    }
    if (lat != null && lng != null && !coordinatesInKenya(lat, lng)) {
      errors.push(`GPS ${lat.toFixed(5)}, ${lng.toFixed(5)} is outside Kenya`);
      lat = null; lng = null;
    }

    // --- Dates --------------------------------------------------------------
    const install = parseImportDate(get("installationDate"));
    if (get("installationDate") && !install.date) warnings.push(`Could not read installation date "${get("installationDate")}"`);
    if (install.ambiguous) warnings.push("Installation date read as DD/MM/YYYY — check if it was MM/DD/YYYY");
    if (install.date && install.date.getTime() > Date.now()) {
      warnings.push("Installation date is in the future");
    }

    const inspection = parseImportDate(get("lastInspectionDate"));

    // --- Consistency --------------------------------------------------------
    if (status === "IN_FIELD" && (lat == null || lng == null)) {
      warnings.push("Marked In field but has no GPS — it will not appear on the map");
    }

    // --- Store / region -----------------------------------------------------
    const storeName = get("storeName");
    const store = storeName
      ? ctx.stores.find((s) => s.name.toLowerCase().includes(storeName.toLowerCase()) || storeName.toLowerCase().includes(s.name.toLowerCase()))
      : null;
    if (storeName && !store) warnings.push(`Store "${storeName}" not recognised — using your default store`);

    const region = get("region") || store?.region || ctx.defaultRegion;

    const yearRaw = get("yearOfManufacture");
    const yearParsed = yearRaw ? (toNumber(yearRaw) ?? parseImportDate(yearRaw).date?.getFullYear() ?? null) : null;
    const yearOfManufacture = yearParsed && yearParsed >= 1950 && yearParsed <= new Date().getFullYear() ? yearParsed : null;
    if (yearRaw && yearOfManufacture == null) warnings.push(`Year "${yearRaw}" is not usable — leaving blank`);

    const text = (field: string) => get(field) || null;

    const data: ImportRowData = {
      serialNumber,
      gNumber: get("gNumber") ? get("gNumber").toUpperCase() : null,
      manufacturerId: matched?.id ?? null,
      manufacturerName: matched?.name ?? manufacturerName,
      ratingKva: ratingKva != null ? Math.round(ratingKva) : null,
      status: status ?? "IN_STORE",
      primaryKv: toNumber(get("primaryKv")),
      secondaryKv: toNumber(get("secondaryKv")),
      yearOfManufacture,
      locationDescription: text("locationDescription"),
      lat, lng,
      region: region ?? null,
      storeId: store?.id ?? ctx.defaultStoreId,
      installationDateISO: install.date?.toISOString() ?? null,
      lastInspectionDateISO: inspection.date?.toISOString() ?? null,
      oilBdvKv: toNumber(get("oilBdvKv")),
      irHv: toNumber(get("irHv")),
      irLv: toNumber(get("irLv")),
      phases: toNumber(get("phases")),
      coolingType: text("coolingType"),
      impedancePct: toNumber(get("impedancePct")),
      vectorGroup: text("vectorGroup"),
      oilVolumeLitres: toNumber(get("oilVolumeLitres")),
      frequencyHz: toNumber(get("frequencyHz")),
      duty: text("duty"),
      standardRef: text("standardRef"),
      hvInsulationLevelKv: text("hvInsulationLevelKv"),
      tempRiseOilC: toNumber(get("tempRiseOilC")),
      tempRiseWindingC: toNumber(get("tempRiseWindingC")),
      tempClass: text("tempClass"),
      maxAmbientTempC: toNumber(get("maxAmbientTempC")),
      insulationOilType: text("insulationOilType"),
      oilWeightKg: toNumber(get("oilWeightKg")),
      totalWeightKg: toNumber(get("totalWeightKg")),
      tapRange: text("tapRange"),
      deliveryNoteRef: text("deliveryNoteRef"),
      vehiclePlate: get("vehiclePlate") ? get("vehiclePlate").toUpperCase().replace(/\s+/g, "") : null,
      driverName: text("driverName"),
      driverPhone: text("driverPhone"),
    };

    if (duplicate) warnings.push(`Serial ${serialNumber} already exists — it will be skipped unless you choose to update`);

    const level: ImportLevel = errors.length ? "error" : warnings.length ? "warning" : "valid";
    return { rowNumber, level, errors, warnings, duplicate, data };
  });
}
