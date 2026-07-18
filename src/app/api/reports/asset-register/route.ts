import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, toXlsx, type Column } from "@/lib/reports";
import { computeWarranty, warrantyLabel } from "@/lib/warranty";
import { formatDate, STATUS_META } from "@/lib/format";

/** GET /api/reports/asset-register?format=csv|xlsx — every unit in the region. */

type Row = {
  gNumber: string | null;
  serialNumber: string;
  manufacturer: { name: string };
  ratingKva: number;
  status: keyof typeof STATUS_META;
  region: string | null;
  currentSiteName: string | null;
  feeder: string | null;
  warrantyStart: Date | null;
  warrantyMonths: number;
  commissionDate: Date | null;
  tests: { passed: boolean }[];
};

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.gNumber ?? "NOT ASSIGNED", width: 16 },
  { header: "Serial Number", value: (r) => r.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.manufacturer.name, width: 26 },
  { header: "Rating (kVA)", value: (r) => r.ratingKva, width: 12 },
  { header: "Status", value: (r) => STATUS_META[r.status].label, width: 13 },
  { header: "Region", value: (r) => r.region ?? "—", width: 16 },
  { header: "Site", value: (r) => r.currentSiteName ?? "—", width: 24 },
  { header: "Feeder", value: (r) => r.feeder ?? "—", width: 16 },
  { header: "Warranty", value: (r) => warrantyLabel(computeWarranty(r.warrantyStart, r.warrantyMonths)), width: 16 },
  { header: "Commissioned", value: (r) => formatDate(r.commissionDate), width: 14 },
  { header: "Last Test", value: (r) => (r.tests.length ? (r.tests[0].passed ? "Pass" : "Fail") : "—"), width: 10 },
];

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const scope = user.role !== "ADMIN" && user.region ? { region: user.region } : {};

    const rows = await prisma.transformer.findMany({
      where: scope,
      orderBy: [{ status: "asc" }, { gNumber: "asc" }],
      include: {
        manufacturer: { select: { name: true } },
        tests: { orderBy: { testedAt: "desc" }, take: 1, select: { passed: true } },
      },
    });

    const title = "Transformer Pulse — Regional Asset Register";
    const subtitle = `${user.region ?? "All regions"} · ${rows.length} transformers`;

    if (format === "csv") {
      return new NextResponse(toCsv(rows as Row[], COLUMNS), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": attachment("asset-register", "csv"),
        },
      });
    }

    const buffer = await toXlsx({ rows: rows as Row[], columns: COLUMNS, title, subtitle, generatedBy: user.name, sheetName: "Assets" });
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
