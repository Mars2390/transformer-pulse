import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { detectHeaders, parseCsv, parseXlsx } from "@/lib/import-parse";
import { buildRows } from "@/lib/import-rows";

/**
 * POST /api/import/preview — read an uploaded file and validate every row.
 *
 * Nothing is written here. The client gets back the parsed, checked rows and
 * commits them in batches afterwards, which is what gives us a progress bar and
 * keeps any single request small enough to finish on a slow connection.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

export async function POST(request: Request) {
  try {
    const user = await requireApiRole("STORE_KEEPER", "ADMIN");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 10 MB. Split it and import in parts." }, { status: 413 });
    }

    const name = file.name.toLowerCase();
    const isCsv = name.endsWith(".csv");
    const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");
    if (!isCsv && !isExcel) {
      return NextResponse.json({ error: "Upload a .csv, .xlsx or .xls file." }, { status: 415 });
    }

    let grid: string[][];
    try {
      grid = isCsv ? parseCsv(await file.text()) : await parseXlsx(await file.arrayBuffer());
    } catch {
      return NextResponse.json(
        { error: "That file could not be read. If it is an old .xls, re-save it as .xlsx." },
        { status: 422 },
      );
    }

    if (grid.length < 2) {
      return NextResponse.json({ error: "The file has a header but no data rows." }, { status: 422 });
    }

    // Find the header row: the first row that maps at least two known fields.
    // Real KPLC sheets often carry a title line or two above the headers.
    let headerRowIndex = 0;
    let headers = detectHeaders(grid[0]);
    for (let i = 0; i < Math.min(grid.length, 8); i++) {
      const candidate = detectHeaders(grid[i]);
      if (Object.keys(candidate.index).length > Object.keys(headers.index).length) {
        headers = candidate;
        headerRowIndex = i;
      }
      if (Object.keys(candidate.index).length >= 4) { headers = candidate; headerRowIndex = i; break; }
    }

    if (!("serialNumber" in headers.index)) {
      return NextResponse.json(
        {
          error:
            "No serial-number column found. Download the template to see the headers the importer recognises.",
          detectedColumns: grid[headerRowIndex],
        },
        { status: 422 },
      );
    }

    // Skip the template's greyed-out instruction line if it is still there.
    let dataRows = grid.slice(headerRowIndex + 1);
    const first = dataRows[0];
    if (first && /leave blank|must match|from the nameplate|whole number|dd\/mm\/yyyy/i.test(first.join(" "))) {
      dataRows = dataRows.slice(1);
      headerRowIndex += 1;
    }

    if (dataRows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `That file has ${dataRows.length} rows. Import at most ${MAX_ROWS} at a time.` },
        { status: 413 },
      );
    }

    const [manufacturers, stores, existing] = await Promise.all([
      prisma.manufacturer.findMany({ select: { id: true, name: true } }),
      prisma.store.findMany({ select: { id: true, name: true, region: true } }),
      prisma.transformer.findMany({ select: { serialNumber: true } }),
    ]);

    const rows = buildRows(dataRows, {
      headers,
      manufacturers,
      stores,
      existingSerials: new Set(existing.map((t) => t.serialNumber)),
      defaultRegion: user.region ?? null,
      defaultStoreId: user.storeId ?? null,
    }, headerRowIndex);

    return NextResponse.json({
      fileName: file.name,
      totalRows: rows.length,
      summary: {
        valid: rows.filter((r) => r.level === "valid").length,
        warning: rows.filter((r) => r.level === "warning").length,
        error: rows.filter((r) => r.level === "error").length,
        duplicates: rows.filter((r) => r.duplicate).length,
      },
      recognisedColumns: Object.keys(headers.index),
      unmappedColumns: headers.unmapped,
      rows,
    });
  } catch (error) {
    return apiError(error);
  }
}
