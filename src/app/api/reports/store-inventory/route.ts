import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, toXlsx, type Column } from "@/lib/reports";
import { computeWarranty, warrantyLabel } from "@/lib/warranty";
import { formatDate, STATUS_META } from "@/lib/format";

/**
 * GET /api/reports/store-inventory?format=csv|xlsx
 *
 * The store's stock, as it stands right now.
 */

type Row = {
  gNumber: string | null;
  serialNumber: string;
  manufacturer: { name: string };
  ratingKva: number;
  primaryKv: number;
  secondaryKv: number;
  status: keyof typeof STATUS_META;
  yearOfManufacture: number;
  warrantyStart: Date | null;
  warrantyMonths: number;
  currentSiteName: string | null;
  currentStore: { name: string } | null;
  createdAt: Date;
  tests: { passed: boolean; testedAt: Date }[];
};

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.gNumber ?? "NOT ASSIGNED", width: 16 },
  { header: "Serial Number", value: (r) => r.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.manufacturer.name, width: 26 },
  { header: "Rating (kVA)", value: (r) => r.ratingKva, width: 12 },
  { header: "Voltage", value: (r) => `${r.primaryKv} / ${r.secondaryKv} kV`, width: 14 },
  { header: "Year", value: (r) => r.yearOfManufacture, width: 8 },
  { header: "Status", value: (r) => STATUS_META[r.status].label, width: 13 },
  {
    header: "Intake Test",
    value: (r) => (r.tests.length === 0 ? "Untested" : r.tests[0].passed ? "Passed" : "FAILED"),
    width: 12,
  },
  {
    header: "Tested On",
    value: (r) => (r.tests[0] ? formatDate(r.tests[0].testedAt) : ""),
    width: 13,
  },
  { header: "Warranty Start", value: (r) => formatDate(r.warrantyStart), width: 14 },
  {
    header: "Warranty Status",
    value: (r) => warrantyLabel(computeWarranty(r.warrantyStart, r.warrantyMonths)),
    width: 16,
  },
  {
    header: "Location",
    value: (r) => r.currentSiteName ?? r.currentStore?.name ?? "—",
    width: 24,
  },
  { header: "Date Received", value: (r) => formatDate(r.createdAt), width: 14 },
];

export async function GET(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "MANAGER", "ADMIN");
    const format = new URL(request.url).searchParams.get("format") ?? "csv";

    // A store keeper exports their own store. A manager exports their region.
    const where =
      actor.role === "STORE_KEEPER" && actor.storeId
        ? { currentStoreId: actor.storeId }
        : actor.role === "MANAGER" && actor.region
          ? { region: actor.region }
          : {};

    const rows = (await prisma.transformer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        manufacturer: { select: { name: true } },
        currentStore: { select: { name: true } },
        tests: {
          where: { stage: "STORE_INTAKE" },
          orderBy: { testedAt: "desc" },
          take: 1,
          select: { passed: true, testedAt: true },
        },
      },
    })) as unknown as Row[];

    const store = actor.storeId
      ? await prisma.store.findUnique({ where: { id: actor.storeId } })
      : null;

    const scopeName = store ? `${store.name} (${store.code})` : (actor.region ?? "All regions");

    if (format === "xlsx") {
      const buffer = await toXlsx({
        rows,
        columns: COLUMNS,
        title: "Transformer Pulse — Store Inventory Report",
        subtitle: scopeName,
        generatedBy: actor.name,
        sheetName: "Inventory",
      });

      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": attachment(`store-inventory-${scopeName}`, "xlsx"),
        },
      });
    }

    return new NextResponse(toCsv(rows, COLUMNS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachment(`store-inventory-${scopeName}`, "csv"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
