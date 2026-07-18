import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, type Column } from "@/lib/reports";
import { formatDate } from "@/lib/format";

/**
 * GET /api/reports/inspection-compliance?format=csv
 *
 * Every in-field unit and how long since it was last seen. The overdue rows are
 * the field team's work list — and the manager's proof that assets are, or are
 * not, being checked.
 */

const DAY = 86_400_000;
const OVERDUE_DAYS = 180;

type Row = {
  gNumber: string | null;
  serialNumber: string;
  currentSiteName: string | null;
  region: string | null;
  commissionDate: Date | null;
  events: { occurredAt: Date; user: { name: string } }[];
};

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const scope = user.role === "MANAGER" && user.region ? { region: user.region } : {};

    const rows = await prisma.transformer.findMany({
      where: { ...scope, status: "IN_FIELD" },
      select: {
        gNumber: true, serialNumber: true, currentSiteName: true, region: true, commissionDate: true,
        events: {
          where: { type: { in: ["INSPECTED", "INSTALLED"] } },
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: { occurredAt: true, user: { select: { name: true } } },
        },
      },
      orderBy: { currentSiteName: "asc" },
    });

    const columns: Column<Row>[] = [
      { header: "G-Number", value: (r) => r.gNumber ?? r.serialNumber },
      { header: "Location", value: (r) => r.currentSiteName ?? "—" },
      { header: "Region", value: (r) => r.region ?? "—" },
      {
        header: "Last Inspection",
        value: (r) => formatDate(r.events[0]?.occurredAt ?? r.commissionDate),
      },
      {
        header: "Days Since",
        value: (r) => {
          const last = r.events[0]?.occurredAt ?? r.commissionDate;
          return last ? Math.floor((Date.now() - last.getTime()) / DAY) : "";
        },
      },
      {
        header: "Status",
        value: (r) => {
          const last = r.events[0]?.occurredAt ?? r.commissionDate;
          const days = last ? (Date.now() - last.getTime()) / DAY : Infinity;
          return days > OVERDUE_DAYS ? "OVERDUE" : "OK";
        },
      },
      { header: "Field Engineer", value: (r) => r.events[0]?.user.name ?? "—" },
    ];

    return new NextResponse(toCsv(rows as Row[], columns), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachment("inspection-compliance", "csv"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
