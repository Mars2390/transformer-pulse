import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toCsv, toXlsx, type Column } from "@/lib/reports";
import { dmy } from "@/lib/report-data";
import { csv, xlsx } from "../asset-register/route";

/**
 * GET /api/reports/engineer-performance?format=csv|xlsx
 *
 * Per field engineer: activity this month and this year, and the average time a
 * unit waits between dispatch and their install. A manager sees their region; a
 * field engineer sees only their own row.
 */

const DAY = 86_400_000;

type Row = {
  name: string; region: string | null; lastLoginAt: Date | null;
  instMonth: number; inspMonth: number; faultMonth: number;
  instYear: number; inspYear: number; faultYear: number;
  avgDispatchToInstall: number | null;
};

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN", "FIELD_ENGINEER");
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const engineers = await prisma.user.findMany({
      where: {
        role: "FIELD_ENGINEER",
        ...(user.role === "FIELD_ENGINEER" ? { id: user.id } : user.region && user.role === "MANAGER" ? { region: user.region } : {}),
      },
      select: { id: true, name: true, region: true, lastLoginAt: true },
      orderBy: { name: "asc" },
    });

    const rows: Row[] = [];
    for (const eng of engineers) {
      const events = await prisma.lifecycleEvent.findMany({
        where: { userId: eng.id, type: { in: ["INSTALLED", "INSPECTED", "FAULT_REPORTED"] }, occurredAt: { gte: yearStart } },
        select: { type: true, occurredAt: true, transformerId: true },
      });
      const count = (type: string, since: Date) => events.filter((e) => e.type === type && e.occurredAt >= since).length;

      // Average dispatch → install: for each unit this engineer installed, the
      // gap to that transformer's most recent prior dispatch.
      const installs = events.filter((e) => e.type === "INSTALLED");
      let gaps: number[] = [];
      if (installs.length) {
        const dispatches = await prisma.lifecycleEvent.findMany({
          where: { transformerId: { in: installs.map((i) => i.transformerId) }, type: "DISPATCHED" },
          select: { transformerId: true, occurredAt: true },
        });
        gaps = installs
          .map((i) => {
            const d = dispatches.filter((x) => x.transformerId === i.transformerId && x.occurredAt <= i.occurredAt).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
            return d ? (i.occurredAt.getTime() - d.occurredAt.getTime()) / DAY : null;
          })
          .filter((v): v is number => v != null);
      }

      rows.push({
        name: eng.name, region: eng.region, lastLoginAt: eng.lastLoginAt,
        instMonth: count("INSTALLED", monthStart), inspMonth: count("INSPECTED", monthStart), faultMonth: count("FAULT_REPORTED", monthStart),
        instYear: count("INSTALLED", yearStart), inspYear: count("INSPECTED", yearStart), faultYear: count("FAULT_REPORTED", yearStart),
        avgDispatchToInstall: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
      });
    }

    const columns: Column<Row>[] = [
      { header: "Engineer", value: (r) => r.name, width: 20 },
      { header: "Region", value: (r) => r.region ?? "", width: 15 },
      { header: "Installs (Month)", value: (r) => r.instMonth, width: 12 },
      { header: "Inspections (Month)", value: (r) => r.inspMonth, width: 13 },
      { header: "Faults (Month)", value: (r) => r.faultMonth, width: 11 },
      { header: "Total Events (Month)", value: (r) => r.instMonth + r.inspMonth + r.faultMonth, width: 13 },
      { header: "Installs (Year)", value: (r) => r.instYear, width: 11 },
      { header: "Inspections (Year)", value: (r) => r.inspYear, width: 13 },
      { header: "Faults (Year)", value: (r) => r.faultYear, width: 11 },
      { header: "Avg Days Dispatch→Install", value: (r) => r.avgDispatchToInstall ?? "", width: 16 },
      { header: "Last Active", value: (r) => dmy(r.lastLoginAt), width: 13 },
    ];

    if (format === "csv") return csv(toCsv(rows, columns), "engineer-performance");

    const buffer = await toXlsx({
      rows, columns,
      title: "Transformer Pulse — Engineer Performance Report",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} engineers`,
      generatedBy: user.name,
      region: user.region ?? "All regions",
      sheetName: "Performance",
    });
    return xlsx(buffer, "engineer-performance");
  } catch (error) {
    return apiError(error);
  }
}
