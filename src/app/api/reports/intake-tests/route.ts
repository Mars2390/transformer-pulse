import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toXlsx, type Column } from "@/lib/reports";
import { formatDate } from "@/lib/format";

/** GET /api/reports/intake-tests?format=xlsx — every intake test value by unit. */

type Row = {
  testedAt: Date;
  stage: string;
  passed: boolean;
  insulationResistanceHvMohm: number | null;
  insulationResistanceLvMohm: number | null;
  turnsRatioDeviationPct: number | null;
  oilBdvKv: number | null;
  remarks: string | null;
  transformer: { gNumber: string | null; serialNumber: string; manufacturer: { name: string } };
  testedBy: { name: string };
};

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.transformer.gNumber ?? r.transformer.serialNumber, width: 16 },
  { header: "Serial", value: (r) => r.transformer.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.transformer.manufacturer.name, width: 24 },
  { header: "Test Date", value: (r) => formatDate(r.testedAt), width: 14 },
  { header: "Stage", value: (r) => r.stage.replace(/_/g, " "), width: 16 },
  { header: "IR HV-Earth (MΩ)", value: (r) => r.insulationResistanceHvMohm ?? "—", width: 15 },
  { header: "IR LV-Earth (MΩ)", value: (r) => r.insulationResistanceLvMohm ?? "—", width: 15 },
  { header: "Turns Ratio Dev (%)", value: (r) => r.turnsRatioDeviationPct ?? "—", width: 16 },
  { header: "Oil BDV (kV)", value: (r) => r.oilBdvKv ?? "—", width: 12 },
  { header: "Status", value: (r) => (r.passed ? "In field" : "Faulty"), width: 12 }, // colour-coded via STATUS_FILL
  { header: "Result", value: (r) => (r.passed ? "PASS" : "FAIL"), width: 10 },
  { header: "Tested By", value: (r) => r.testedBy.name, width: 18 },
];

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const scope = user.role !== "ADMIN" && user.region ? { transformer: { region: user.region } } : {};

    const rows = await prisma.testRecord.findMany({
      where: scope,
      orderBy: { testedAt: "desc" },
      take: 5000,
      include: {
        transformer: { select: { gNumber: true, serialNumber: true, manufacturer: { select: { name: true } } } },
        testedBy: { select: { name: true } },
      },
    });

    const buffer = await toXlsx({
      rows: rows as Row[],
      columns: COLUMNS,
      title: "Transformer Pulse — Intake Test Register",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} tests`,
      generatedBy: user.name,
      sheetName: "Tests",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": attachment("intake-test-register", "xlsx"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
