import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { xlsx } from "@/lib/report-response";
import { toXlsx, type Column } from "@/lib/reports";
import { buildManufacturerPerformance, type ManufacturerPerformance } from "@/lib/manufacturer-performance";

/**
 * GET /api/reports/manufacturer-performance — manufacturer reliability as a workbook.
 */

const COLUMNS: Column<ManufacturerPerformance>[] = [
  { header: "Manufacturer", value: (r) => r.name, width: 22 },
  { header: "Country", value: (r) => r.country ?? "", width: 14 },
  { header: "Units in Fleet", value: (r) => r.unitsInFleet, width: 13 },
  {
    header: "Failure Rate %",
    value: (r) => (r.failureRatePct != null ? Number(r.failureRatePct.toFixed(1)) : ""),
    width: 14, numFmt: "0.0",
    tone: (r) => (r.failureRatePct != null && r.failureRatePct > 20 ? "critical" : r.failureRatePct != null && r.failureRatePct > 5 ? "warning" : "good"),
  },
  { header: "Avg Service Life (yrs)", value: (r) => (r.avgServiceLifeYears != null ? Number(r.avgServiceLifeYears.toFixed(1)) : ""), width: 18, numFmt: "0.0" },
  { header: "Warranty Claims Filed", value: (r) => r.warrantyClaimsFiled, width: 18 },
  { header: "Claims Settled", value: (r) => r.claimsSettled, width: 14 },
  { header: "Claims Disputed", value: (r) => r.claimsDisputed, width: 14 },
  { header: "Most Common Fault", value: (r) => r.mostCommonFault ?? "", width: 32 },
  { header: "Avg IR Decline/Yr (MOhm)", value: (r) => (r.avgIrDeclinePerYearMohm != null ? Number(r.avgIrDeclinePerYearMohm.toFixed(2)) : ""), width: 20, numFmt: "0.00" },
  { header: "Avg BDV Decline/Yr (kV)", value: (r) => (r.avgBdvDeclinePerYearKv != null ? Number(r.avgBdvDeclinePerYearKv.toFixed(2)) : ""), width: 19, numFmt: "0.00" },
];

export async function GET() {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const rows = await buildManufacturerPerformance();
    const stamp = new Date().toISOString().slice(0, 10);

    const buffer = await toXlsx({
      rows,
      columns: COLUMNS,
      sheetName: "Manufacturer Performance",
      title: "Manufacturer Performance",
      subtitle: `${rows.length} manufacturers, worst failure rate first`,
      generatedBy: actor.name,
      footerLines: [
        "Failure rate: share of a manufacturer's units with at least one recorded fault.",
        "Avg service life: years from installation to retirement (or years in service so far, if still active).",
        "IR/BDV decline: average rate of change between each unit's first and last test. Positive means declining.",
      ],
    });

    return xlsx(buffer, `manufacturer-performance-${stamp}`);
  } catch (error) {
    return apiError(error);
  }
}
