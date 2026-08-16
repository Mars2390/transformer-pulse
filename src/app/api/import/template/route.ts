import ExcelJS from "exceljs";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { csv, xlsx } from "@/lib/report-response";

/**
 * GET /api/import/template?type=quick|full&format=csv|xlsx
 *
 * The blank sheet KPLC fills in. Row 1 is the headers the importer recognises,
 * row 2 is a greyed-out instruction line, and data starts at row 3 — which is
 * exactly what the preview endpoint expects back.
 */

type Col = { header: string; hint: string; required?: boolean };

const QUICK: Col[] = [
  { header: "Serial Number", hint: "From the nameplate", required: true },
  { header: "Manufacturer", hint: "Must match a registered manufacturer", required: true },
  { header: "Rating (kVA)", hint: "Whole number, e.g. 315", required: true },
  { header: "Status", hint: "IN_STORE / IN_FIELD / IN_TRANSIT / FAULTY / RETURNED", required: true },
  { header: "G-Number", hint: "G-2026-00001 (leave blank if not issued)" },
  { header: "Primary Voltage (kV)", hint: "e.g. 11" },
  { header: "Secondary Voltage (kV)", hint: "e.g. 0.415" },
  { header: "Year of Manufacture", hint: "e.g. 2019" },
  { header: "Location Description", hint: "Site or area name" },
  { header: "GPS Latitude", hint: "-1.292100 or 1°17'31.6\"S" },
  { header: "GPS Longitude", hint: "36.821900" },
  { header: "Region", hint: "e.g. Nairobi North" },
  { header: "Store", hint: "Receiving store name" },
  { header: "Installation Date", hint: "DD/MM/YYYY" },
  { header: "Oil BDV (kV)", hint: "Latest reading" },
  { header: "IR HV-Earth (MΩ)", hint: "Latest reading" },
  { header: "IR LV-Earth (MΩ)", hint: "Latest reading" },
];

const FULL: Col[] = [
  ...QUICK,
  { header: "Phases", hint: "1 or 3" },
  { header: "Cooling Type", hint: "ONAN / ONAF" },
  { header: "Impedance %", hint: "e.g. 4.5" },
  { header: "Vector Group", hint: "e.g. Dyn11" },
  { header: "Oil Litres", hint: "Oil volume" },
  { header: "Frequency (Hz)", hint: "50" },
  { header: "Duty", hint: "CONT" },
  { header: "Standard", hint: "IEC 60076" },
  { header: "HV Insulation Level / BIL", hint: "125/50" },
  { header: "Oil Temp Rise", hint: "°C, e.g. 60" },
  { header: "Winding Temp Rise", hint: "°C, e.g. 65" },
  { header: "Temp Class", hint: "A" },
  { header: "Max Ambient", hint: "°C, e.g. 40" },
  { header: "Insulation Oil Type", hint: "e.g. Nytro 10GBNP" },
  { header: "Oil Weight (kg)", hint: "e.g. 2200" },
  { header: "Total Weight (kg)", hint: "e.g. 10000" },
  { header: "Tap Range", hint: "e.g. 22550-20350 V (5 taps)" },
  { header: "Delivery Note Reference", hint: "GRN / DN number" },
  { header: "Vehicle Plate", hint: "KDG 456T" },
  { header: "Driver Name", hint: "" },
  { header: "Driver Phone", hint: "0722123456" },
  { header: "Last Inspection Date", hint: "DD/MM/YYYY" },
];

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("STORE_KEEPER", "ADMIN");
    const url = new URL(request.url);
    const cols = url.searchParams.get("type") === "full" ? FULL : QUICK;
    const name = url.searchParams.get("type") === "full" ? "import-template-full" : "import-template-quick";

    if (url.searchParams.get("format") === "csv") {
      const header = cols.map((c) => `${c.header}${c.required ? " *" : ""}`).join(",");
      const hints = cols.map((c) => `"${c.hint.replace(/"/g, '""')}"`).join(",");
      return csv(`﻿${header}\r\n${hints}\r\n`, name);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Transformer DNA";
    const sheet = workbook.addWorksheet("Transformers", { views: [{ state: "frozen", ySplit: 2 }] });

    const headerRow = sheet.getRow(1);
    cols.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = `${c.header}${c.required ? " *" : ""}`;
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FF006837" : "FF1E40AF" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      sheet.getColumn(i + 1).width = Math.max(14, c.header.length + 4);
    });
    headerRow.height = 28;

    const hintRow = sheet.getRow(2);
    cols.forEach((c, i) => {
      const cell = hintRow.getCell(i + 1);
      cell.value = c.hint;
      cell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF9AA0AE" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    });

    // Everything below the instruction row is the user's to fill in.
    sheet.getCell("A3").note =
      "Enter one transformer per row, starting here. Columns marked * are required. Green = required, blue = optional.";

    const buffer = new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    return xlsx(buffer, name);
  } catch (error) {
    return apiError(error);
  }
}
