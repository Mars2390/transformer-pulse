import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, toXlsx, type Column } from "@/lib/reports";
import { formatDateTime } from "@/lib/format";

/** GET /api/reports/fault-report?format=csv|xlsx — faults, by cause and maker. */

type Row = {
  occurredAt: Date;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  transformer: { gNumber: string | null; serialNumber: string; ratingKva: number; manufacturer: { name: string }; currentSiteName: string | null };
  user: { name: string };
};

const COLUMNS: Column<Row>[] = [
  { header: "Date", value: (r) => formatDateTime(r.occurredAt), width: 18 },
  { header: "G-Number", value: (r) => r.transformer.gNumber ?? r.transformer.serialNumber, width: 16 },
  { header: "Rating (kVA)", value: (r) => r.transformer.ratingKva, width: 12 },
  { header: "Manufacturer", value: (r) => r.transformer.manufacturer.name, width: 24 },
  { header: "Site", value: (r) => r.transformer.currentSiteName ?? "—", width: 22 },
  { header: "Reported By", value: (r) => r.user.name, width: 18 },
  { header: "Cause & Notes", value: (r) => r.notes ?? "—", width: 44 },
  { header: "GPS", value: (r) => (r.lat != null ? `${r.lat.toFixed(5)}, ${r.lng?.toFixed(5)}` : "—"), width: 20 },
];

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const scope = user.role === "MANAGER" && user.region ? { transformer: { region: user.region } } : {};

    const rows = await prisma.lifecycleEvent.findMany({
      where: { ...scope, type: "FAULT_REPORTED" },
      orderBy: { occurredAt: "desc" },
      take: 2000,
      include: {
        transformer: {
          select: { gNumber: true, serialNumber: true, ratingKva: true, currentSiteName: true, manufacturer: { select: { name: true } } },
        },
        user: { select: { name: true } },
      },
    });

    if (format === "csv") {
      return new NextResponse(toCsv(rows as Row[], COLUMNS), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": attachment("fault-report", "csv"),
        },
      });
    }

    const buffer = await toXlsx({
      rows: rows as Row[],
      columns: COLUMNS,
      title: "Transformer Pulse — Fault Report",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} faults`,
      generatedBy: user.name,
      sheetName: "Faults",
    });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": attachment("fault-report", "xlsx"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
