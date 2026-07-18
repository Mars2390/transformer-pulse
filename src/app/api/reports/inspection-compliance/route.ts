import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toCsv, toXlsx, type Column } from "@/lib/reports";
import {
  dmy, daysSince, gps, inspectionStatus, trend, INSPECTION_OVERDUE,
} from "@/lib/report-data";
import { csv, xlsx } from "@/lib/report-response";

/**
 * GET /api/reports/inspection-compliance?format=csv|xlsx
 *
 * Every in-field unit, most overdue first. The overdue rows are the field
 * team's work list and the manager's proof that assets are being checked.
 */

type Row = {
  gNumber: string | null; serialNumber: string; region: string | null;
  currentSiteName: string | null; currentLat: number | null; currentLng: number | null;
  status: string; commissionDate: Date | null;
  events: { occurredAt: Date; user: { name: string } }[];
  tests: { oilBdvKv: number | null }[];
  _days: number | null;
};

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const scope = user.role === "MANAGER" && user.region ? { region: user.region } : {};

    const found = await prisma.transformer.findMany({
      where: { ...scope, status: "IN_FIELD" },
      select: {
        gNumber: true, serialNumber: true, region: true, currentSiteName: true,
        currentLat: true, currentLng: true, status: true, commissionDate: true,
        events: {
          where: { type: { in: ["INSPECTED", "INSTALLED"] } },
          orderBy: { occurredAt: "desc" }, take: 1,
          select: { occurredAt: true, user: { select: { name: true } } },
        },
        tests: { orderBy: { testedAt: "desc" }, take: 3, select: { oilBdvKv: true } },
      },
    });

    const rows: Row[] = found
      .map((t) => ({ ...t, _days: daysSince(t.events[0]?.occurredAt ?? t.commissionDate) }))
      .sort((a, b) => (b._days ?? 1e9) - (a._days ?? 1e9)); // most overdue first

    const columns: Column<Row>[] = [
      { header: "G-Number", value: (r) => r.gNumber ?? r.serialNumber, width: 15 },
      { header: "Serial Number", value: (r) => r.serialNumber, width: 18 },
      { header: "Region", value: (r) => r.region ?? "", width: 15 },
      { header: "Location", value: (r) => r.currentSiteName ?? "", width: 22 },
      { header: "GPS Latitude", value: (r) => gps(r.currentLat), width: 13 },
      { header: "GPS Longitude", value: (r) => gps(r.currentLng), width: 13 },
      { header: "Status", value: (r) => "In field", width: 10 },
      { header: "Last Inspection", value: (r) => dmy(r.events[0]?.occurredAt ?? r.commissionDate), width: 15 },
      { header: "Days Since Inspection", value: (r) => r._days ?? "", width: 12 },
      { header: "Compliance", value: (r) => inspectionStatus(r._days).label, width: 12, tone: (r) => inspectionStatus(r._days).tone },
      { header: "Last Inspected By", value: (r) => r.events[0]?.user.name ?? "", width: 16 },
      { header: "Last Oil BDV (kV)", value: (r) => r.tests[0]?.oilBdvKv ?? "", width: 12 },
      { header: "Oil BDV Trend", value: (r) => trend(r.tests.map((t) => t.oilBdvKv)), width: 18 },
    ];

    if (format === "csv") return csv(toCsv(rows, columns), "inspection-report");

    const overdue = rows.filter((r) => (r._days ?? 0) > INSPECTION_OVERDUE).length;
    const compliant = rows.length - overdue;
    const worst = rows[0];

    const buffer = await toXlsx({
      rows,
      columns,
      title: "Transformer Pulse — Inspection Compliance Report",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} in field`,
      generatedBy: user.name,
      region: user.region ?? "All regions",
      sheetName: "Inspections",
      footerLines: [
        `Total in field: ${rows.length} | Compliant: ${compliant} (${rows.length ? Math.round((compliant / rows.length) * 100) : 0}%) | Overdue: ${overdue} (${rows.length ? Math.round((overdue / rows.length) * 100) : 0}%)`,
        worst && (worst._days ?? 0) > INSPECTION_OVERDUE ? `Most overdue: ${worst.gNumber ?? worst.serialNumber} (${worst._days} days)` : "No overdue inspections.",
      ],
    });
    return xlsx(buffer, "inspection-report");
  } catch (error) {
    return apiError(error);
  }
}
