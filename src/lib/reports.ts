import "server-only";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Report generation.
 *
 * CSV is hand-rolled — fifteen lines, and a dependency for that is a liability.
 * XLSX uses ExcelJS because it embeds the KPLC logo and colour-codes cells: the
 * claim pack leaves KPLC and lands on a manufacturer's desk, so it must look
 * like it came from a utility, not from a laptop.
 *
 * A column can declare a `numFmt` (Excel display format, ignored by CSV so the
 * raw number stays clean) and a `tone` function (conditional cell fill by
 * status/compliance/warranty). Dates are pre-formatted to DD/MM/YYYY strings in
 * each column's `value`, so CSV and XLSX read identically.
 */

export type CellTone =
  | "field" | "faulty" | "store" | "transit" | "returned" | "scrapped"
  | "ok" | "due" | "overdue"
  | "covered" | "expiring" | "critical" | "expired"
  | "pass" | "fail" | "good" | "warning";

export type Column<T> = {
  header: string;
  /** Value for a data row. Return a primitive; formatting belongs here. */
  value: (row: T) => string | number | null;
  width?: number;
  /** Excel number format, e.g. '#,##0.00' or '"KES" #,##0'. XLSX only. */
  numFmt?: string;
  /** Conditional cell fill by meaning. XLSX only. */
  tone?: (row: T) => CellTone | null;
};

// --- CSV --------------------------------------------------------------------

/**
 * Escapes a CSV cell.
 *
 * The leading-character check is not paranoia: Excel executes a cell starting
 * with =, +, - or @ as a formula. A site name of "=cmd|..." in our database
 * would run on the machine of whoever opens the export. Prefixing a quote
 * neutralises it.
 */
function csvCell(value: string | number | null): string {
  if (value == null) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  if (rows.length === 0) {
    lines.push(csvCell("No data available"));
  }
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  }
  // CRLF and a BOM: Excel on Windows misreads UTF-8 without them, and every
  // KPLC desktop is Excel on Windows.
  return "﻿" + lines.join("\r\n");
}

// --- XLSX -------------------------------------------------------------------

const KPLC_GREEN = "FF006837"; // header per spec
const KPLC_NAVY = "FF0A1A4F";
const KPLC_BLUE = "FF1E40AF";
const KPLC_GOLD = "FFF5B700";
const ROW_ALT = "FFF5F5F5";

/** Conditional cell fills, one consistent palette across every export. */
const TONE_FILL: Record<CellTone, string> = {
  field: "FFD1FAE5", // green
  faulty: "FFFEE2E2", // red
  store: "FFDBEAFE", // blue
  transit: "FFEDE9FE", // purple
  returned: "FFE5E7EB", // grey
  scrapped: "FFE5E7EB",
  ok: "FFD1FAE5",
  due: "FFFEF3C7", // amber
  overdue: "FFFEE2E2",
  covered: "FFD1FAE5",
  expiring: "FFFEF3C7",
  critical: "FFFEE2E2",
  expired: "FFE5E7EB",
  pass: "FFD1FAE5",
  fail: "FFFEE2E2",
  good: "FFD1FAE5",
  warning: "FFFEF3C7",
};

const TONE_BOLD: Set<CellTone> = new Set(["faulty", "overdue", "critical", "fail", "expired"]);

export type XlsxSheet<T> = {
  name: string;
  rows: T[];
  columns: Column<T>[];
};

export async function toXlsx<T>({
  rows,
  columns,
  title,
  subtitle,
  generatedBy,
  region,
  sheetName = "Report",
  footerLines = [],
  // Uint8Array<ArrayBuffer> specifically, not the default ArrayBufferLike:
  // only the former satisfies the web BodyInit type NextResponse expects.
}: {
  rows: T[];
  columns: Column<T>[];
  title: string;
  subtitle?: string;
  generatedBy: string;
  region?: string;
  sheetName?: string;
  footerLines?: string[];
}): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = await newWorkbook();
  await addSheet(workbook, { name: sheetName, rows, columns }, { title, subtitle, generatedBy, region, footerLines });
  return finalise(workbook);
}

/** A workbook with a cover sheet plus one data sheet per group. */
export async function toXlsxWorkbook<T>({
  sheets,
  title,
  generatedBy,
  region,
  cover,
  footerLines = [],
}: {
  sheets: XlsxSheet<T>[];
  title: string;
  generatedBy: string;
  region?: string;
  cover?: { heading: string; lines: string[] };
  footerLines?: string[];
}): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = await newWorkbook();

  if (cover) {
    const sheet = workbook.addWorksheet("Summary");
    sheet.getColumn(1).width = 90;
    await brandHeader(workbook, sheet, { title, subtitle: cover.heading, generatedBy, region, cols: 1 });
    let r = 6;
    for (const line of cover.lines) {
      const cell = sheet.getCell(r, 1);
      cell.value = line;
      cell.font = { name: "Calibri", size: 11, color: { argb: KPLC_NAVY } };
      sheet.getRow(r).height = 18;
      r++;
    }
  }

  for (const sheet of sheets) {
    await addSheet(workbook, sheet, { title, subtitle: sheet.name, generatedBy, region, footerLines });
  }
  return finalise(workbook);
}

// --- internals --------------------------------------------------------------

async function newWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transformer DNA";
  workbook.created = new Date();
  return workbook;
}

async function loadLogo(workbook: ExcelJS.Workbook): Promise<number | null> {
  try {
    const logo = await readFile(path.join(process.cwd(), "public", "images", "kenya-power-logo.png"));
    return workbook.addImage({ base64: logo.toString("base64"), extension: "png" });
  } catch {
    return null;
  }
}

async function brandHeader(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  { title, subtitle, generatedBy, region, cols }: { title: string; subtitle?: string; generatedBy: string; region?: string; cols: number },
) {
  const last = Math.max(cols, 2);

  sheet.mergeCells(1, 1, 1, last);
  const t = sheet.getCell(1, 1);
  t.value = title;
  t.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_NAVY } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 8 };
  sheet.getRow(1).height = 40;

  sheet.mergeCells(2, 1, 2, last);
  const s = sheet.getCell(2, 1);
  s.value = subtitle ?? "Transformer DNA";
  s.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" } };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_BLUE } };
  s.alignment = { vertical: "middle", horizontal: "left", indent: 8 };
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, last);
  const m = sheet.getCell(3, 1);
  const stamp = new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  m.value = `Generated: ${stamp}  |  By: ${generatedBy}${region ? `  |  Region: ${region}` : ""}`;
  m.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5B6480" } };
  m.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

  sheet.getRow(4).height = 6;

  const imageId = await loadLogo(workbook);
  if (imageId != null && cols >= 2) {
    sheet.addImage(imageId, { tl: { col: last - 1.4, row: 0.12 }, ext: { width: 46, height: 46 } });
  }
}

async function addSheet<T>(
  workbook: ExcelJS.Workbook,
  { name, rows, columns }: XlsxSheet<T>,
  meta: { title: string; subtitle?: string; generatedBy: string; region?: string; footerLines: string[] },
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  const lastCol = columns.length;

  await brandHeader(workbook, sheet, { ...meta, cols: lastCol });

  // Column headers — KPLC green, white text, frozen.
  const headerRow = sheet.getRow(5);
  columns.forEach((column, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = column.header;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_GREEN } };
    cell.alignment = { vertical: "middle", wrapText: true };
    sheet.getColumn(i + 1).width = column.width ?? 16;
  });
  headerRow.height = 26;

  if (rows.length === 0) {
    const r = sheet.addRow(["No data available"]);
    r.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF5B6480" } };
  }

  rows.forEach((row, ri) => {
    const added = sheet.addRow(columns.map((c) => c.value(row) ?? ""));
    added.font = { name: "Calibri", size: 10 };
    const alt = ri % 2 === 1;

    columns.forEach((column, ci) => {
      const cell = added.getCell(ci + 1);
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E5EB" } } };
      if (column.numFmt) cell.numFmt = column.numFmt;

      const tone = column.tone?.(row) ?? null;
      if (tone) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } };
        if (TONE_BOLD.has(tone)) cell.font = { name: "Calibri", size: 10, bold: true };
      } else if (alt) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT } };
      }
    });
  });

  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: lastCol } };

  // Footer.
  sheet.addRow([]);
  const footer = sheet.addRow([`Generated by Transformer DNA | Kenya Power`]);
  footer.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5B6480" } };
  sheet.mergeCells(footer.number, 1, footer.number, lastCol);
  for (const line of meta.footerLines) {
    const fr = sheet.addRow([line]);
    fr.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5B6480" } };
    sheet.mergeCells(fr.number, 1, fr.number, lastCol);
  }
}

async function finalise(workbook: ExcelJS.Workbook): Promise<Uint8Array<ArrayBuffer>> {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

/** Content-Disposition value with a dated, readable filename. */
export function attachment(name: string, extension: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `attachment; filename="${safe}-${stamp}.${extension}"`;
}
