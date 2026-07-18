import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { attachment, toXlsx, type Column } from "@/lib/reports";
import { computeWarranty } from "@/lib/warranty";
import { formatDate } from "@/lib/format";

/**
 * GET /api/reports/warranty-pack?format=xlsx
 *
 * The document that leaves KPLC and lands on a manufacturer's desk. It carries
 * each unit's fault, value, warranty position, AND the head of its custody
 * chain — the hash a manufacturer's engineer cannot argue with.
 */

type Row = {
  transformer: {
    gNumber: string | null;
    serialNumber: string;
    ratingKva: number;
    warrantyStart: Date | null;
    warrantyMonths: number;
    lastEventHash: string | null;
  };
  manufacturer: { name: string };
  status: string;
  faultReason: string;
  createdAt: Date;
  claimValueKes: unknown;
  referenceNo: string | null;
};

const COLUMNS: Column<Row>[] = [
  { header: "G-Number", value: (r) => r.transformer.gNumber ?? "—", width: 16 },
  { header: "Serial", value: (r) => r.transformer.serialNumber, width: 18 },
  { header: "Manufacturer", value: (r) => r.manufacturer.name, width: 24 },
  { header: "Rating (kVA)", value: (r) => r.transformer.ratingKva, width: 12 },
  { header: "Fault", value: (r) => r.faultReason, width: 40 },
  { header: "Fault Date", value: (r) => formatDate(r.createdAt), width: 14 },
  {
    header: "Warranty Expiry",
    value: (r) => formatDate(computeWarranty(r.transformer.warrantyStart, r.transformer.warrantyMonths).expiresAt),
    width: 15,
  },
  { header: "Claim Value (KES)", value: (r) => (r.claimValueKes ? Number(r.claimValueKes) : 0), width: 16 },
  { header: "RMA Ref", value: (r) => r.referenceNo ?? "—", width: 16 },
  { header: "Status", value: (r) => r.status, width: 12 },
  { header: "Chain Hash", value: (r) => r.transformer.lastEventHash ?? "—", width: 24 },
];

export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const scope = user.role === "MANAGER" && user.region ? { region: user.region } : {};

    const rows = await prisma.warrantyClaim.findMany({
      where: { transformer: scope, status: { in: ["OPEN", "SUBMITTED", "APPROVED"] } },
      orderBy: [{ manufacturerId: "asc" }, { createdAt: "desc" }],
      include: {
        manufacturer: { select: { name: true } },
        transformer: {
          select: { gNumber: true, serialNumber: true, ratingKva: true, warrantyStart: true, warrantyMonths: true, lastEventHash: true },
        },
      },
    });

    const total = rows.reduce((s, r) => s + Number(r.claimValueKes ?? 0), 0);
    const buffer = await toXlsx({
      rows: rows as Row[],
      columns: COLUMNS,
      title: "Transformer Pulse — Warranty Claim Pack",
      subtitle: `${user.region ?? "All regions"} · ${rows.length} claims · KES ${total.toLocaleString("en-KE")} recoverable`,
      generatedBy: user.name,
      sheetName: "Claims",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": attachment("warranty-claim-pack", "xlsx"),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
