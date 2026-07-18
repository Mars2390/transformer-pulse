import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, toXlsx, type Column } from "@/lib/reports";
import {
  loadEnriched, reportScope, dmy, gps, STATUS_TONE, type EnrichedTransformer,
} from "@/lib/report-data";
import { STATUS_META } from "@/lib/format";

/**
 * GET /api/reports/asset-register?format=csv|xlsx
 *
 * The master export: every field an asset manager needs to make a decision,
 * with calculated columns (days-since, trends, warranty position, health, chain
 * status) computed once per unit in the enrichment layer.
 */

type R = EnrichedTransformer;

const COLUMNS: Column<R>[] = [
  { header: "G-Number", value: (r) => r.tx.gNumber ?? "NOT ASSIGNED", width: 16 },
  { header: "Serial Number", value: (r) => r.tx.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.tx.manufacturer.name, width: 22 },
  { header: "Rating (kVA)", value: (r) => r.tx.ratingKva, width: 11 },
  { header: "Primary (kV)", value: (r) => r.tx.primaryKv, width: 11 },
  { header: "Secondary (kV)", value: (r) => r.tx.secondaryKv, width: 12 },
  { header: "Year", value: (r) => r.tx.yearOfManufacture, width: 8 },
  { header: "Status", value: (r) => STATUS_META[r.tx.status].label, width: 12, tone: (r) => STATUS_TONE[r.tx.status] },
  { header: "Region", value: (r) => r.tx.region ?? "", width: 15 },
  { header: "Location", value: (r) => r.tx.currentSiteName ?? "", width: 22 },
  { header: "GPS Latitude", value: (r) => gps(r.tx.currentLat), width: 13 },
  { header: "GPS Longitude", value: (r) => gps(r.tx.currentLng), width: 13 },
  { header: "Installation Date", value: (r) => dmy(r.installDate), width: 15 },
  { header: "Days Since Install", value: (r) => r.daysSinceInstall ?? "", width: 12 },
  { header: "Last Inspection", value: (r) => dmy(r.lastInspectionDate), width: 15 },
  { header: "Days Since Inspection", value: (r) => r.daysSinceInspection ?? "", width: 12 },
  { header: "Inspection Status", value: (r) => r.inspection.label, width: 14, tone: (r) => r.inspection.tone },
  { header: "Last Oil BDV (kV)", value: (r) => r.lastOilBdv ?? "", width: 12 },
  { header: "Oil BDV Trend", value: (r) => r.oilBdvTrend, width: 18 },
  { header: "Last IR HV (MΩ)", value: (r) => r.lastIrHv ?? "", width: 12 },
  { header: "IR HV Trend", value: (r) => r.irHvTrend, width: 18 },
  { header: "Last IR LV (MΩ)", value: (r) => r.lastIrLv ?? "", width: 12 },
  { header: "IR LV Trend", value: (r) => r.irLvTrend, width: 18 },
  { header: "Faults (12mo)", value: (r) => r.faults12mo, width: 11 },
  { header: "Last Fault Date", value: (r) => dmy(r.lastFaultDate), width: 14 },
  { header: "Last Fault Cause", value: (r) => r.lastFaultCause, width: 30 },
  { header: "Warranty Expiry", value: (r) => dmy(r.warrantyExpiry), width: 14 },
  { header: "Warranty Days Left", value: (r) => r.warrantyDaysLeft ?? "", width: 12 },
  { header: "Warranty Status", value: (r) => r.warranty.label, width: 14, tone: (r) => r.warranty.tone },
  { header: "Health", value: (r) => r.healthLabel, width: 10, tone: (r) => r.healthTone },
  { header: "Chain Status", value: (r) => (r.chainValid ? "Verified" : "BROKEN"), width: 12, tone: (r) => (r.chainValid ? "ok" : "fail") },
  { header: "Store", value: (r) => r.tx.currentStore?.name ?? "", width: 20 },
  { header: "Dispatched By", value: (r) => r.dispatchedBy, width: 16 },
  { header: "Installed By", value: (r) => r.installedBy, width: 16 },
  { header: "Last Inspected By", value: (r) => r.lastInspectedBy, width: 16 },
];

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const { rows, verified, total } = await loadEnriched(reportScope(user.role, user.region));

    if (format === "csv") {
      return csv(toCsv(rows, COLUMNS), "asset-register");
    }

    const buffer = await toXlsx({
      rows,
      columns: COLUMNS,
      title: "Transformer Pulse — Regional Asset Register",
      subtitle: `${user.region ?? "All regions"} · ${total} units`,
      generatedBy: user.name,
      region: user.region ?? "All regions",
      sheetName: "Assets",
      footerLines: [`Chain Verification: ${verified} of ${total} transformers verified | ${new Date().toLocaleDateString("en-GB")}`],
    });
    return xlsx(buffer, "asset-register");
  } catch (error) {
    return apiError(error);
  }
}

export function csv(body: string, name: string) {
  return new NextResponse(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(name, "csv") },
  });
}
export function xlsx(buffer: Uint8Array<ArrayBuffer>, name: string) {
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(name, "xlsx"),
    },
  });
}
