import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toCsv, type Column } from "@/lib/reports";
import { dmy, gps } from "@/lib/report-data";
import { STATUS_META } from "@/lib/format";
import { csv } from "../asset-register/route";

/**
 * GET /api/reports/locations — a clean GPS CSV for import into any mapping tool.
 *
 * Deliberately minimal and un-branded: this file is meant to be fed to QGIS,
 * Google My Maps or a GIS team, not read by a human. Only located units.
 */

type Row = {
  gNumber: string | null; serialNumber: string; status: string;
  currentLat: number | null; currentLng: number | null;
  currentSiteName: string | null; region: string | null; ratingKva: number;
  events: { occurredAt: Date }[];
};

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.gNumber ?? r.serialNumber },
  { header: "Serial Number", value: (r) => r.serialNumber },
  { header: "Status", value: (r) => STATUS_META[r.status as keyof typeof STATUS_META].label },
  { header: "Latitude", value: (r) => gps(r.currentLat) },
  { header: "Longitude", value: (r) => gps(r.currentLng) },
  { header: "Location", value: (r) => r.currentSiteName ?? "" },
  { header: "Region", value: (r) => r.region ?? "" },
  { header: "Rating (kVA)", value: (r) => r.ratingKva },
  { header: "Last Inspection", value: (r) => dmy(r.events[0]?.occurredAt) },
];

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "FIELD_ENGINEER");
    const scope = user.role !== "ADMIN" && user.region ? { region: user.region } : {};

    const rows = (await prisma.transformer.findMany({
      where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
      orderBy: { currentSiteName: "asc" },
      select: {
        gNumber: true, serialNumber: true, status: true, currentLat: true, currentLng: true,
        currentSiteName: true, region: true, ratingKva: true,
        events: { where: { type: { in: ["INSPECTED", "INSTALLED"] } }, orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
    })) as Row[];

    return csv(toCsv(rows, COLUMNS), "transformer-locations");
  } catch (error) {
    return apiError(error);
  }
}
