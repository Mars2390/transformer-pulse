import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { parseCsv, parseXlsx, detectHeaders, toNumber, parseImportDate } from "@/lib/import-parse";

/**
 * POST /api/control/upload — ingest a day of smart-meter interval data.
 *
 * ~96,000 rows (1000 meters × 96 intervals). Inserted with createMany in
 * chunks: one statement per chunk instead of one round trip per row, which is
 * the difference between seconds and many minutes against a remote database.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 250_000;
const CHUNK = 5_000;

// Meter columns are not in the shared import aliases — telemetry, not assets.
const METER_ALIASES: Record<string, string[]> = {
  meterId: ["meterid", "meter id", "meter", "meter_no", "meter number", "msn"],
  timestamp: ["timestamp", "time", "datetime", "date time", "reading time", "interval"],
  voltage: ["voltage", "volts", "v", "voltage (v)"],
  current: ["current", "amps", "a", "current (a)"],
  power: ["power", "kw", "power (kw)", "active power", "load"],
  powerFactor: ["powerfactor", "power factor", "pf", "cos phi"],
};

/**
 * Reads a meter timestamp as an absolute instant.
 *
 * Deliberately NOT `new Date("2026-07-18 00:00")`: that form is parsed as LOCAL
 * time, so in Nairobi (UTC+3) the midnight interval is stored as 21:00 the
 * previous day and every label on the dashboard is shifted three hours. Unless
 * the string carries an explicit zone, it is treated as UTC so the clock in the
 * file is the clock on the screen.
 */
function parseMeterTimestamp(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // Carries its own offset (…Z or …+03:00) — trust it.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2026-07-18 19:15[:00] or 2026-07-18T19:15
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +(iso[6] ?? 0)));
  }

  // 18/07/2026 19:15 — day first, Kenyan convention.
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ T](\d{1,2}):(\d{2})/);
  if (dmy) {
    return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], +dmy[4], +dmy[5]));
  }

  // A bare time of day — a file of one day's intervals with no date column.
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return new Date(Date.UTC(2026, 0, 1, +hm[1], +hm[2]));

  // Excel serial with a fractional day.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
  }

  // Date only — still usable, all readings land on one interval.
  return parseImportDate(s).date;
}

function mapMeterHeaders(headerRow: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  headerRow.forEach((raw, i) => {
    const h = raw.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    for (const [field, aliases] of Object.entries(METER_ALIASES)) {
      if (field in index) continue;
      if (aliases.includes(h) || aliases.some((a) => h === a || h.replace(/\s/g, "") === a.replace(/\s/g, ""))) {
        index[field] = i;
      }
    }
  });
  return index;
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");

    const form = await request.formData();
    const file = form.get("file");
    const transformerRef = String(form.get("transformerRef") ?? "").trim() || null;
    const ratingKva = Number(form.get("ratingKva") ?? 200) || 200;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 25 MB." }, { status: 413 });
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
      return NextResponse.json({ error: "That file could not be read." }, { status: 422 });
    }
    if (grid.length < 2) {
      return NextResponse.json({ error: "The file has no data rows." }, { status: 422 });
    }

    const headers = mapMeterHeaders(grid[0]);
    for (const required of ["meterId", "timestamp", "power"]) {
      if (!(required in headers)) {
        return NextResponse.json(
          { error: `No "${required}" column found. Expected: meterId, timestamp, voltage, current, power, powerFactor.`, detected: grid[0] },
          { status: 422 },
        );
      }
    }

    const dataRows = grid.slice(1);
    if (dataRows.length > MAX_ROWS) {
      return NextResponse.json({ error: `That file has ${dataRows.length} rows; the limit is ${MAX_ROWS}.` }, { status: 413 });
    }

    type Parsed = { meterId: string; ts: Date; voltage: number; current: number; power: number; pf: number };
    const parsed: Parsed[] = [];
    const tsKeys = new Set<string>();
    const meterIds = new Set<string>();

    for (const row of dataRows) {
      const get = (f: string) => (headers[f] == null ? "" : String(row[headers[f]] ?? "").trim());
      const meterId = get("meterId");
      if (!meterId) continue;

      const ts = parseMeterTimestamp(get("timestamp"));
      if (!ts) continue;

      parsed.push({
        meterId,
        ts,
        voltage: toNumber(get("voltage")) ?? 0,
        current: toNumber(get("current")) ?? 0,
        power: toNumber(get("power")) ?? 0,
        pf: toNumber(get("powerFactor")) ?? 0,
      });
      tsKeys.add(ts.toISOString());
      meterIds.add(meterId);
    }

    if (parsed.length === 0) {
      return NextResponse.json({ error: "No readable rows — check the meterId and timestamp columns." }, { status: 422 });
    }

    const intervals = [...tsKeys].sort();
    const intervalIndexOf = new Map(intervals.map((t, i) => [t, i]));
    const meterList = [...meterIds].sort();
    const meterOrder = new Map(meterList.map((m, i) => [m, i]));

    const meterCount = meterList.length;
    const batchSize = Math.max(1, Math.ceil(meterCount / 5)); // always 5 batches

    // Only one dataset drives the control room at a time.
    await prisma.meterDataset.updateMany({ where: { active: true }, data: { active: false } });

    const dataset = await prisma.meterDataset.create({
      data: {
        name: file.name,
        transformerRef,
        ratingKva,
        meterCount,
        intervalCount: intervals.length,
        batchSize,
        uploadedById: actor.id,
        uploadedByName: actor.name,
        active: true,
      },
    });

    const records = parsed.map((r) => ({
      datasetId: dataset.id,
      intervalIndex: intervalIndexOf.get(r.ts.toISOString())!,
      batchIndex: Math.min(4, Math.floor((meterOrder.get(r.meterId) ?? 0) / batchSize)),
      meterId: r.meterId,
      timestamp: r.ts,
      voltage: r.voltage,
      current: r.current,
      power: r.power,
      powerFactor: r.pf,
    }));

    for (let i = 0; i < records.length; i += CHUNK) {
      await prisma.meterReading.createMany({ data: records.slice(i, i + CHUNK) });
    }

    await writeAudit({
      actorId: actor.id,
      action: "CREATE",
      targetType: "Transformer",
      targetId: dataset.id,
      targetLabel: file.name,
      details: `Meter data uploaded: ${records.length} readings, ${meterCount} meters, ${intervals.length} intervals`,
    });

    return NextResponse.json({
      dataset: {
        id: dataset.id, name: dataset.name, meterCount,
        intervalCount: intervals.length, batchSize, ratingKva, transformerRef,
      },
      readings: records.length,
    }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** DELETE /api/control/upload — wipe the active dataset so a fresh one can go in. */
export async function DELETE() {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const active = await prisma.meterDataset.findFirst({ where: { active: true } });
    if (!active) return NextResponse.json({ ok: true, deleted: 0 });

    // Readings cascade with the dataset.
    await prisma.meterDataset.delete({ where: { id: active.id } });
    await writeAudit({
      actorId: actor.id, action: "DELETE", targetType: "Transformer",
      targetId: active.id, targetLabel: active.name,
      details: "Meter dataset deleted",
    });
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (error) {
    return apiError(error);
  }
}
