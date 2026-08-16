import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toXlsx, type Column } from "@/lib/reports";
import { dmy } from "@/lib/report-data";
import { xlsx } from "@/lib/report-response";

/** GET /api/reports/intake-tests?format=xlsx — every intake test value by unit. */

type Row = {
  testedAt: Date;
  insulationResistanceHvMohm: number | null;
  insulationResistanceLvMohm: number | null;
  turnsRatioDeviationPct: number | null;
  windingResistanceHvOhm: number | null;
  windingResistanceLvOhm: number | null;
  oilBdvKv: number | null;
  oilTempC: number | null;
  ambientTempC: number | null;
  polarityOk: boolean | null;
  passed: boolean;
  transformer: { gNumber: string | null; serialNumber: string; ratingKva: number; currentStore: { name: string } | null; manufacturer: { name: string } };
  testedBy: { name: string };
};

const passFail = (v: boolean | null) => (v == null ? "—" : v ? "Pass" : "Fail");

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.transformer.gNumber ?? r.transformer.serialNumber, width: 15 },
  { header: "Serial Number", value: (r) => r.transformer.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.transformer.manufacturer.name, width: 22 },
  { header: "Rating (kVA)", value: (r) => r.transformer.ratingKva, width: 11 },
  { header: "Store", value: (r) => r.transformer.currentStore?.name ?? "", width: 20 },
  { header: "Test Date", value: (r) => dmy(r.testedAt), width: 13 },
  { header: "IR HV-Earth (MΩ)", value: (r) => r.insulationResistanceHvMohm ?? "", width: 13 },
  { header: "IR LV-Earth (MΩ)", value: (r) => r.insulationResistanceLvMohm ?? "", width: 13 },
  { header: "Turns Ratio Dev (%)", value: (r) => r.turnsRatioDeviationPct ?? "", width: 14 },
  { header: "Winding Res HV (Ω)", value: (r) => r.windingResistanceHvOhm ?? "", width: 14 },
  { header: "Winding Res LV (Ω)", value: (r) => r.windingResistanceLvOhm ?? "", width: 14 },
  { header: "Oil BDV (kV)", value: (r) => r.oilBdvKv ?? "", width: 11 },
  { header: "Oil Temp (°C)", value: (r) => r.oilTempC ?? "", width: 11 },
  { header: "Ambient Temp (°C)", value: (r) => r.ambientTempC ?? "", width: 13 },
  { header: "Polarity Check", value: (r) => passFail(r.polarityOk), width: 12, tone: (r) => (r.polarityOk === false ? "fail" : r.polarityOk ? "pass" : null) },
  { header: "Vector Group Check", value: (r) => passFail(r.polarityOk), width: 14, tone: (r) => (r.polarityOk === false ? "fail" : r.polarityOk ? "pass" : null) },
  { header: "Visual Inspection", value: (r) => (r.passed ? "Pass" : "Fail"), width: 13, tone: (r) => (r.passed ? "pass" : "fail") },
  { header: "Overall Result", value: (r) => (r.passed ? "PASS" : "FAIL"), width: 12, tone: (r) => (r.passed ? "pass" : "fail") },
  { header: "Tested By", value: (r) => r.testedBy.name, width: 16 },
];

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const scope =
      user.role === "STORE_KEEPER" && user.region ? { transformer: { region: user.region } } :
      user.role === "MANAGER" && user.region ? { transformer: { region: user.region } } : {};

    const rows = (await prisma.testRecord.findMany({
      where: { ...scope, stage: "STORE_INTAKE" },
      orderBy: { testedAt: "desc" },
      take: 5000,
      include: {
        transformer: { select: { gNumber: true, serialNumber: true, ratingKva: true, currentStore: { select: { name: true } }, manufacturer: { select: { name: true } } } },
        testedBy: { select: { name: true } },
      },
    })) as Row[];

    const buffer = await toXlsx({
      rows, columns: COLUMNS,
      title: "Transformer DNA — Intake Test Register",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} tests`,
      generatedBy: user.name,
      region: user.region ?? "All regions",
      sheetName: "Intake Tests",
    });
    return xlsx(buffer, "intake-test-register");
  } catch (error) {
    return apiError(error);
  }
}
