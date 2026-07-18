import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, toXlsx, type Column } from "@/lib/reports";
import { computeWarranty } from "@/lib/warranty";
import { computeHealth } from "@/lib/health";
import { formatDate, STATUS_META } from "@/lib/format";

/** GET /api/reports/asset-register?format=csv|xlsx — every unit in the region. */

type Row = {
  gNumber: string | null;
  serialNumber: string;
  manufacturer: { name: string };
  ratingKva: number;
  status: keyof typeof STATUS_META;
  currentSiteName: string | null;
  currentLat: number | null;
  currentLng: number | null;
  yearOfManufacture: number;
  warrantyStart: Date | null;
  warrantyMonths: number;
  tests: {
    passed: boolean;
    testedAt: Date;
    oilBdvKv: number | null;
    insulationResistanceHvMohm: number | null;
    turnsRatioDeviationPct: number | null;
  }[];
  _count: { events: number };
  faultCount: number;
};

function health(r: Row): number {
  const ageYears = new Date().getFullYear() - r.yearOfManufacture;
  return computeHealth({ latestTest: r.tests[0] ?? null, failureCount: r.faultCount, ageYears }).score;
}

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.gNumber ?? "NOT ASSIGNED", width: 16 },
  { header: "Serial Number", value: (r) => r.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.manufacturer.name, width: 24 },
  { header: "Rating (kVA)", value: (r) => r.ratingKva, width: 12 },
  { header: "Status", value: (r) => STATUS_META[r.status].label, width: 13 },
  { header: "Location", value: (r) => r.currentSiteName ?? "—", width: 24 },
  { header: "GPS (Lat, Long)", value: (r) => (r.currentLat != null ? `${r.currentLat.toFixed(5)}, ${r.currentLng?.toFixed(5)}` : "—"), width: 22 },
  { header: "Warranty Expiry", value: (r) => formatDate(computeWarranty(r.warrantyStart, r.warrantyMonths).expiresAt), width: 15 },
  { header: "Last Test Date", value: (r) => formatDate(r.tests[0]?.testedAt), width: 14 },
  { header: "Health Score", value: (r) => health(r), width: 12 },
];

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const scope = user.role !== "ADMIN" && user.region ? { region: user.region } : {};

    const found = await prisma.transformer.findMany({
      where: scope,
      orderBy: [{ status: "asc" }, { gNumber: "asc" }],
      include: {
        manufacturer: { select: { name: true } },
        tests: {
          orderBy: { testedAt: "desc" },
          take: 1,
          select: { passed: true, testedAt: true, oilBdvKv: true, insulationResistanceHvMohm: true, turnsRatioDeviationPct: true },
        },
        _count: { select: { events: true } },
      },
    });

    // Fault counts in one grouped query rather than N per-row queries.
    const faults = await prisma.lifecycleEvent.groupBy({
      by: ["transformerId"],
      where: { type: "FAULT_REPORTED", transformer: scope },
      _count: { _all: true },
    });
    const faultMap = new Map(faults.map((f) => [f.transformerId, f._count._all]));
    const rows: Row[] = found.map((t) => ({ ...t, faultCount: faultMap.get(t.id) ?? 0 }));

    const title = "Transformer Pulse — Regional Asset Register";
    const subtitle = `${user.region ?? "All regions"} · ${rows.length} transformers`;

    if (format === "csv") {
      return new NextResponse(toCsv(rows, COLUMNS), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": attachment("asset-register", "csv"),
        },
      });
    }

    const buffer = await toXlsx({ rows, columns: COLUMNS, title, subtitle, generatedBy: user.name, sheetName: "Assets" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": attachment("asset-register", "xlsx"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
