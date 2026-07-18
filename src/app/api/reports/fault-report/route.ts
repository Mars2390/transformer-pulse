import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toCsv, toXlsx, type Column } from "@/lib/reports";
import { computeWarranty } from "@/lib/warranty";
import { dmy, gps } from "@/lib/report-data";
import { csv, xlsx } from "../asset-register/route";

/** GET /api/reports/fault-report?format=csv|xlsx — faults with claim outcome. */

const DAY = 86_400_000;

type FaultRow = {
  occurredAt: Date;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  user: { name: string };
  transformer: {
    id: string; gNumber: string | null; serialNumber: string; ratingKva: number;
    region: string | null; currentSiteName: string | null; commissionDate: Date | null;
    warrantyStart: Date | null; warrantyMonths: number;
    manufacturer: { name: string };
    claims: { status: string; claimValueKes: unknown; resolvedAt: Date | null; createdAt: Date }[];
  };
  replacementG: string;
};

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    const scope = user.role === "MANAGER" && user.region ? { transformer: { region: user.region } } : {};

    const events = await prisma.lifecycleEvent.findMany({
      where: { ...scope, type: "FAULT_REPORTED" },
      orderBy: [{ transformer: { region: "asc" } }, { occurredAt: "desc" }],
      include: {
        user: { select: { name: true } },
        transformer: {
          select: {
            id: true, gNumber: true, serialNumber: true, ratingKva: true, region: true,
            currentSiteName: true, commissionDate: true, warrantyStart: true, warrantyMonths: true,
            manufacturer: { select: { name: true } },
            claims: { select: { status: true, claimValueKes: true, resolvedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } },
          },
        },
      },
    });

    // Replacement G-Numbers: a faulty unit's RECOVERED event links to the new
    // unit's INSTALLED event. Resolve those in one batch.
    const recovered = await prisma.lifecycleEvent.findMany({
      where: { transformerId: { in: events.map((e) => e.transformerId) }, type: "RECOVERED", linkedEventId: { not: null } },
      select: { transformerId: true, linkedEvent: { select: { transformer: { select: { gNumber: true, serialNumber: true } } } } },
    });
    const replacementMap = new Map<string, string>();
    for (const r of recovered) {
      const g = r.linkedEvent?.transformer.gNumber ?? r.linkedEvent?.transformer.serialNumber;
      if (g) replacementMap.set(r.transformerId, g);
    }

    const rows: FaultRow[] = events.map((e) => ({
      ...e,
      replacementG: replacementMap.get(e.transformerId) ?? "",
    })) as FaultRow[];

    const columns: Column<FaultRow>[] = [
      { header: "G-Number", value: (r) => r.transformer.gNumber ?? r.transformer.serialNumber, width: 15 },
      { header: "Serial Number", value: (r) => r.transformer.serialNumber, width: 18 },
      { header: "Manufacturer", value: (r) => r.transformer.manufacturer.name, width: 22 },
      { header: "Rating (kVA)", value: (r) => r.transformer.ratingKva, width: 11 },
      { header: "Region", value: (r) => r.transformer.region ?? "", width: 15 },
      { header: "Location", value: (r) => r.transformer.currentSiteName ?? "", width: 22 },
      { header: "GPS Latitude", value: (r) => gps(r.lat), width: 13 },
      { header: "GPS Longitude", value: (r) => gps(r.lng), width: 13 },
      { header: "Fault Date", value: (r) => dmy(r.occurredAt), width: 13 },
      { header: "Fault Cause", value: (r) => (r.notes ?? "").split(":")[0], width: 20 },
      { header: "Fault Description", value: (r) => r.notes ?? "", width: 38 },
      { header: "Reported By", value: (r) => r.user.name, width: 16 },
      { header: "Installation Date", value: (r) => dmy(r.transformer.commissionDate), width: 15 },
      { header: "Days in Service", value: (r) => (r.transformer.commissionDate ? Math.max(0, Math.floor((r.occurredAt.getTime() - r.transformer.commissionDate.getTime()) / DAY)) : ""), width: 12 },
      { header: "Warranty at Fault", value: (r) => (computeWarranty(r.transformer.warrantyStart, r.transformer.warrantyMonths, r.occurredAt).claimable ? "Yes" : "No"), width: 13, tone: (r) => (computeWarranty(r.transformer.warrantyStart, r.transformer.warrantyMonths, r.occurredAt).claimable ? "ok" : "returned") },
      { header: "Claim Status", value: (r) => r.transformer.claims[0]?.status ?? "None", width: 12 },
      { header: "Claim Value (KES)", value: (r) => (r.transformer.claims[0]?.claimValueKes ? Number(r.transformer.claims[0].claimValueKes) : 0), width: 15, numFmt: '"KES" #,##0' },
      { header: "Resolution Date", value: (r) => dmy(r.transformer.claims[0]?.resolvedAt ?? null), width: 14 },
      { header: "Days to Resolve", value: (r) => { const c = r.transformer.claims[0]; return c?.resolvedAt ? Math.floor((c.resolvedAt.getTime() - c.createdAt.getTime()) / DAY) : ""; }, width: 12 },
      { header: "Replacement G-Number", value: (r) => r.replacementG, width: 16 },
    ];

    if (format === "csv") return csv(toCsv(rows, columns), "fault-report");

    // Summary lines for the footer.
    const byCause = new Map<string, number>();
    const byMaker = new Map<string, number>();
    for (const r of rows) {
      const cause = (r.notes ?? "Unknown").split(":")[0];
      byCause.set(cause, (byCause.get(cause) ?? 0) + 1);
      byMaker.set(r.transformer.manufacturer.name, (byMaker.get(r.transformer.manufacturer.name) ?? 0) + 1);
    }
    const resolved = rows.filter((r) => r.transformer.claims[0]?.resolvedAt);
    const avgResolve = resolved.length
      ? Math.round(resolved.reduce((s, r) => { const c = r.transformer.claims[0]; return s + (c!.resolvedAt!.getTime() - c!.createdAt.getTime()) / DAY; }, 0) / resolved.length)
      : 0;
    const totalKes = rows.reduce((s, r) => s + Number(r.transformer.claims[0]?.claimValueKes ?? 0), 0);

    const buffer = await toXlsx({
      rows,
      columns,
      title: "Transformer Pulse — Fault Analysis Report",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} faults`,
      generatedBy: user.name,
      region: user.region ?? "All regions",
      sheetName: "Faults",
      footerLines: [
        `By cause: ${[...byCause.entries()].map(([k, v]) => `${k} (${v})`).join(", ")}`,
        `By manufacturer: ${[...byMaker.entries()].map(([k, v]) => `${k} (${v})`).join(", ")}`,
        `Average days to resolve: ${avgResolve} | Total claim value: KES ${totalKes.toLocaleString("en-KE")}`,
      ],
    });
    return xlsx(buffer, "fault-report");
  } catch (error) {
    return apiError(error);
  }
}
