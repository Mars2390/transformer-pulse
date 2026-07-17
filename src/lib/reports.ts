import "server-only";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Report generation.
 *
 * CSV is hand-rolled: it is fifteen lines, and a dependency for that is a
 * liability. XLSX uses ExcelJS because it can embed the KPLC logo — the claim
 * pack leaves KPLC and lands on a manufacturer's desk, so it has to look like
 * it came from a utility, not from a laptop.
 */

export type Column<T> = {
  header: string;
  /** Value for a data row. Return a primitive; formatting belongs here. */
  value: (row: T) => string | number | null;
  width?: number;
};

// --- CSV --------------------------------------------------------------------

/**
 * Escapes a CSV cell.
 *
 * The leading-character check is not paranoia: Excel executes a cell starting
 * with =, +, - or @ as a formula. A site name of "=cmd|..." in our database
 * would run on the machine of whoever opens the export. Prefixing with a quote
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
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  }
  // CRLF and a BOM: Excel on Windows misreads UTF-8 without them, and every
  // KPLC desktop is Excel on Windows.
  return "﻿" + lines.join("\r\n");
}

// --- XLSX -------------------------------------------------------------------

const KPLC_BLUE = "FF1E40AF";
const KPLC_NAVY = "FF0A1A4F";
const KPLC_GOLD = "FFF5B700";

/** Cell fills for the status column, so a manager can scan it in one look. */
const STATUS_FILL: Record<string, string> = {
  "In store": "FFDBEAFE",
  "In transit": "FFFEF3C7",
  "In field": "FFD1FAE5",
  Faulty: "FFFEE2E2",
  Returned: "FFE5E7EB",
  Scrapped: "FFE5E7EB",
};

export async function toXlsx<T>({
  rows,
  columns,
  title,
  subtitle,
  generatedBy,
  sheetName = "Report",
}: {
  rows: T[];
  columns: Column<T>[];
  title: string;
  subtitle: string;
  generatedBy: string;
  sheetName?: string;
  // Uint8Array<ArrayBuffer> specifically, not the default ArrayBufferLike:
  // only the former satisfies the web BodyInit type NextResponse expects.
}): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Transformer Pulse";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 5 }], // header block + column headers
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const lastCol = columns.length;

  // --- Branded header block -------------------------------------------------
  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_NAVY } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 8 };
  sheet.getRow(1).height = 38;

  sheet.mergeCells(2, 1, 2, lastCol);
  const subCell = sheet.getCell(2, 1);
  subCell.value = subtitle;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FFFFFFFF" } };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPLC_BLUE } };
  subCell.alignment = { vertical: "middle", horizontal: "left", indent: 8 };
  sheet.getRow(2).height = 20;

  sheet.mergeCells(3, 1, 3, lastCol);
  const metaCell = sheet.getCell(3, 1);
  metaCell.value = `Generated ${new Date().toLocaleString("en-KE")} by ${generatedBy}`;
  metaCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5B6480" } };
  metaCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

  sheet.getRow(4).height = 6; // spacer

  // --- Logo -----------------------------------------------------------------
  // Best effort: if the file is missing the report must still generate. A
  // missing logo is cosmetic; a failed export in front of a manager is not.
  try {
    const logo = await readFile(
      path.join(process.cwd(), "public", "images", "kenya-power-logo.png"),
    );
    // base64 rather than the raw Buffer: ExcelJS's Buffer type and Node's have
    // drifted apart, and this avoids a cast that would hide a real error later.
    const imageId = workbook.addImage({
      base64: logo.toString("base64"),
      extension: "png",
    });
    sheet.addImage(imageId, {
      tl: { col: lastCol - 1.6, row: 0.15 },
      ext: { width: 46, height: 46 },
    });
  } catch {
    // Carry on unbranded.
  }

  // --- Column headers -------------------------------------------------------
  const headerRow = sheet.getRow(5);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: KPLC_NAVY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F6F8" } };
    cell.border = { bottom: { style: "medium", color: { argb: KPLC_GOLD } } };
    cell.alignment = { vertical: "middle" };
    sheet.getColumn(index + 1).width = column.width ?? 18;
  });
  headerRow.height = 22;

  // --- Data -----------------------------------------------------------------
  rows.forEach((row) => {
    const values = columns.map((c) => c.value(row) ?? "");
    const added = sheet.addRow(values);
    added.font = { name: "Calibri", size: 10 };

    columns.forEach((column, index) => {
      const cell = added.getCell(index + 1);
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E5EB" } } };

      if (column.header === "Status") {
        const fill = STATUS_FILL[String(cell.value)];
        if (fill) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          cell.font = { name: "Calibri", size: 10, bold: true };
        }
      }
    });
  });

  // --- Footer ---------------------------------------------------------------
  sheet.addRow([]);
  const footer = sheet.addRow([
    `${rows.length} record${rows.length === 1 ? "" : "s"} · Generated by Transformer Pulse · Custody chain verified at export`,
  ]);
  footer.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF5B6480" } };
  sheet.mergeCells(footer.number, 1, footer.number, lastCol);

  sheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5 + rows.length, column: lastCol },
  };

  // Return a Uint8Array, not a Buffer: NextResponse takes a web BodyInit, and
  // Node's Buffer type drifts from ArrayBufferView across versions.
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(arrayBuffer as ArrayBuffer);
}

/** Content-Disposition value with a dated, readable filename. */
export function attachment(name: string, extension: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `attachment; filename="${safe}-${stamp}.${extension}"`;
}
