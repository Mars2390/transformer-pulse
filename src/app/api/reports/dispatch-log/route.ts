import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toCsv, toXlsx, type Column } from "@/lib/reports";
import { dmy, gps } from "@/lib/report-data";
import { formatPlate } from "@/lib/format";
import { csv, xlsx } from "@/lib/report-response";

/**
 * GET /api/reports/dispatch-log?format=csv|xlsx
 *
 * Each dispatch, paired with its field receipt so a manager can see what left
 * the store, who carried it, and whether it arrived. This is the part paper
 * always loses.
 */

const DAY = 86_400_000;

type Row = {
  occurredAt: Date;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  destination: string | null;
  user: { name: string };
  transformer: {
    id: string; gNumber: string | null; serialNumber: string; ratingKva: number;
    currentLat: number | null; currentLng: number | null;
    manufacturer: { name: string };
  };
  receipt: { occurredAt: Date; user: { name: string } } | null;
};

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

    const scope =
      user.role === "STORE_KEEPER" && user.region ? { transformer: { region: user.region } } :
      user.role === "MANAGER" && user.region ? { transformer: { region: user.region } } : {};

    const dispatches = await prisma.lifecycleEvent.findMany({
      where: { ...scope, type: "DISPATCHED" },
      orderBy: { occurredAt: "desc" },
      take: 3000,
      include: {
        user: { select: { name: true } },
        transformer: {
          select: {
            id: true, gNumber: true, serialNumber: true, ratingKva: true,
            currentLat: true, currentLng: true, manufacturer: { select: { name: true } },
          },
        },
      },
    });

    // Pair each dispatch with the receipt that followed it (if any).
    const receipts = await prisma.lifecycleEvent.findMany({
      where: { transformerId: { in: dispatches.map((d) => d.transformerId) }, type: "RECEIVED_BY_FIELD" },
      orderBy: { occurredAt: "asc" },
      select: { transformerId: true, occurredAt: true, user: { select: { name: true } } },
    });

    const rows: Row[] = dispatches.map((d) => ({
      ...d,
      receipt: receipts.find((r) => r.transformerId === d.transformerId && r.occurredAt >= d.occurredAt) ?? null,
    })) as Row[];

    const store = user.storeId ? await prisma.store.findUnique({ where: { id: user.storeId }, select: { name: true } }) : null;

    const columns: Column<Row>[] = [
      { header: "G-Number", value: (r) => r.transformer.gNumber ?? r.transformer.serialNumber, width: 15 },
      { header: "Serial Number", value: (r) => r.transformer.serialNumber, width: 18 },
      { header: "Manufacturer", value: (r) => r.transformer.manufacturer.name, width: 22 },
      { header: "Rating (kVA)", value: (r) => r.transformer.ratingKva, width: 11 },
      { header: "From (Store)", value: () => store?.name ?? "", width: 22 },
      { header: "To (Destination)", value: (r) => r.destination ?? "", width: 22 },
      { header: "GPS Latitude", value: (r) => gps(r.transformer.currentLat), width: 13 },
      { header: "GPS Longitude", value: (r) => gps(r.transformer.currentLng), width: 13 },
      { header: "Dispatch Date", value: (r) => dmy(r.occurredAt), width: 13 },
      { header: "Vehicle Plate", value: (r) => formatPlate(r.vehiclePlate), width: 13 },
      { header: "Driver Name", value: (r) => r.driverName ?? "", width: 16 },
      { header: "Driver Phone", value: (r) => r.driverPhone ?? "", width: 14 },
      { header: "Dispatched By", value: (r) => r.user.name, width: 16 },
      { header: "Receipt Confirmed", value: (r) => (r.receipt ? "Yes" : "No"), width: 13, tone: (r) => (r.receipt ? "ok" : "due") },
      { header: "Receipt Date", value: (r) => dmy(r.receipt?.occurredAt ?? null), width: 13 },
      { header: "Received By", value: (r) => r.receipt?.user.name ?? "", width: 16 },
      { header: "Days in Transit", value: (r) => (r.receipt ? Math.max(0, Math.floor((r.receipt.occurredAt.getTime() - r.occurredAt.getTime()) / DAY)) : ""), width: 12 },
    ];

    if (format === "csv") return csv(toCsv(rows, columns), "dispatch-log");

    const buffer = await toXlsx({
      rows, columns,
      title: "Transformer DNA — Dispatch & Movement Log",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} dispatches`,
      generatedBy: user.name,
      region: user.region ?? "All regions",
      sheetName: "Dispatches",
    });
    return xlsx(buffer, "dispatch-log");
  } catch (error) {
    return apiError(error);
  }
}
