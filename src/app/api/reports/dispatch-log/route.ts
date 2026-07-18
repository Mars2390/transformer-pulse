import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, type Column } from "@/lib/reports";
import { formatDateTime, formatPlate } from "@/lib/format";

/** GET /api/reports/dispatch-log?format=csv — every movement, vehicle and driver. */

type Row = {
  occurredAt: Date;
  type: string;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  destination: string | null;
  transformer: { gNumber: string | null; serialNumber: string };
  user: { name: string };
};

const COLUMNS: Column<Row>[] = [
  { header: "Date", value: (r) => formatDateTime(r.occurredAt) },
  { header: "Event", value: (r) => r.type },
  { header: "G-Number", value: (r) => r.transformer.gNumber ?? r.transformer.serialNumber },
  { header: "Vehicle", value: (r) => formatPlate(r.vehiclePlate) },
  { header: "Driver", value: (r) => r.driverName ?? "—" },
  { header: "Driver Phone", value: (r) => r.driverPhone ?? "—" },
  { header: "Destination", value: (r) => r.destination ?? "—" },
  { header: "Recorded By", value: (r) => r.user.name },
];

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "STORE_KEEPER");
    const scope = user.role !== "ADMIN" && user.region ? { transformer: { region: user.region } } : {};

    const rows = await prisma.lifecycleEvent.findMany({
      where: { ...scope, type: { in: ["DISPATCHED", "RECOVERED", "RETURNED_TO_MANUFACTURER", "RECEIVED_AT_STORE"] } },
      orderBy: { occurredAt: "desc" },
      take: 2000,
      include: {
        transformer: { select: { gNumber: true, serialNumber: true } },
        user: { select: { name: true } },
      },
    });

    return new NextResponse(toCsv(rows as Row[], COLUMNS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachment("dispatch-log", "csv"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
