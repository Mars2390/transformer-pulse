import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";

/**
 * GET /api/control/batch?interval=N&batch=B — one batch of meters reporting.
 *
 * The server aggregates; the client only draws. Sending 200 raw rows per batch
 * to the browser 480 times over a replay would be megabytes of traffic for
 * numbers nobody looks at individually.
 *
 * Electrical note: the meters report ACTIVE power (kW) and power factor. A
 * transformer is rated in APPARENT power (kVA), so the loading figure must use
 * S = P / cos φ. Comparing kW against a kVA nameplate understates the load and
 * is the classic way to cook a transformer while the dashboard says it is fine.
 */
export async function GET(request: Request) {
  try {
    await requireApiRole("ADMIN", "MANAGER");

    const url = new URL(request.url);
    const interval = Number(url.searchParams.get("interval") ?? 0);
    const batch = Number(url.searchParams.get("batch") ?? 0);

    const dataset = await prisma.meterDataset.findFirst({ where: { active: true } });
    if (!dataset) return NextResponse.json({ error: "No meter data uploaded." }, { status: 404 });

    const rows = await prisma.meterReading.findMany({
      where: { datasetId: dataset.id, intervalIndex: interval, batchIndex: batch },
      select: { meterId: true, voltage: true, current: true, power: true, powerFactor: true, timestamp: true },
    });

    if (rows.length === 0) {
      return NextResponse.json({ interval, batch, meters: 0, empty: true });
    }

    // A meter reporting no voltage is offline, not a meter reading zero volts —
    // excluding it keeps the average honest instead of dragging it down.
    const live = rows.filter((r) => r.voltage > 0);
    const offline = rows.length - live.length;

    const activeKw = rows.reduce((s, r) => s + r.power, 0);
    const pfValues = live.map((r) => r.powerFactor).filter((v) => v > 0);
    const avgPf = pfValues.length ? pfValues.reduce((a, b) => a + b, 0) / pfValues.length : 0.95;
    const apparentKva = avgPf > 0 ? activeKw / avgPf : activeKw;

    const voltages = live.map((r) => r.voltage);
    const avgVoltage = voltages.length ? voltages.reduce((a, b) => a + b, 0) / voltages.length : 0;
    const minVoltage = voltages.length ? Math.min(...voltages) : 0;
    const maxVoltage = voltages.length ? Math.max(...voltages) : 0;
    const lowVoltageMeters = live.filter((r) => r.voltage < 220).length;
    const criticalVoltageMeters = live.filter((r) => r.voltage < 210).length;
    const currentA = rows.reduce((s, r) => s + r.current, 0);

    return NextResponse.json({
      interval,
      batch,
      timestampISO: rows[0].timestamp.toISOString(),
      label: rows[0].timestamp.toISOString().slice(11, 16),
      meters: rows.length,
      live: live.length,
      offline,
      activeKw,
      apparentKva,
      avgPowerFactor: avgPf,
      avgVoltage,
      minVoltage,
      maxVoltage,
      lowVoltageMeters,
      criticalVoltageMeters,
      currentA,
    });
  } catch (error) {
    return apiError(error);
  }
}
