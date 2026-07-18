import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toCsv, type Column } from "@/lib/reports";
import { formatDateTime, ROLE_LABELS } from "@/lib/format";

/** GET /api/admin/audit/export — the admin audit trail as CSV. */

type Row = {
  createdAt: Date;
  action: string;
  targetType: string;
  targetLabel: string;
  details: string | null;
  actor: { name: string; role: string };
};

const COLUMNS: Column<Row>[] = [
  { header: "Timestamp", value: (r) => formatDateTime(r.createdAt) },
  { header: "User", value: (r) => r.actor.name },
  { header: "Role", value: (r) => ROLE_LABELS[r.actor.role as keyof typeof ROLE_LABELS] ?? r.actor.role },
  { header: "Action", value: (r) => r.action },
  { header: "Target", value: (r) => `${r.targetType}: ${r.targetLabel}` },
  { header: "Details", value: (r) => r.details ?? "" },
];

export async function GET() {
  try {
    await requireApiRole("ADMIN");

    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 5000,
      include: { actor: { select: { name: true, role: true } } },
    });

    return new NextResponse(toCsv(rows as Row[], COLUMNS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": attachment("audit-log", "csv"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
