import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { toXlsxWorkbook, type Column, type XlsxSheet } from "@/lib/reports";
import { verifyChain, type ChainLink } from "@/lib/chain";
import { computeWarranty } from "@/lib/warranty";
import { dmy, daysSince, gps } from "@/lib/report-data";
import { xlsx } from "@/lib/report-response";

/**
 * GET /api/reports/warranty-pack — the document sent to manufacturers.
 *
 * One sheet per manufacturer, a summary cover sheet, and every claim carrying
 * the head of its transformer's custody chain. The chain hash is the point: it
 * is arithmetically undeniable proof that the history behind the claim was not
 * edited after the fact.
 */

const DAY = 86_400_000;

type ClaimRow = {
  id: string;
  status: string;
  faultReason: string;
  referenceNo: string | null;
  claimValueKes: unknown;
  createdAt: Date;
  submittedAt: Date | null;
  transformer: {
    gNumber: string | null; serialNumber: string; ratingKva: number;
    currentLat: number | null; currentLng: number | null; currentSiteName: string | null;
    commissionDate: Date | null; warrantyStart: Date | null; warrantyMonths: number;
    lastEventHash: string | null;
    events: { id: string; hash: string; prevHash: string | null; transformerId: string; type: string; toStatus: string; userId: string; occurredAt: Date; lat: number | null; lng: number | null; vehiclePlate: string | null; driverName: string | null; notes: string | null }[];
  };
  manufacturer: { name: string };
};

function columns(): Column<ClaimRow>[] {
  return [
    { header: "Claim ID", value: (r) => r.id.slice(-8).toUpperCase(), width: 12 },
    { header: "G-Number", value: (r) => r.transformer.gNumber ?? "", width: 15 },
    { header: "Serial Number", value: (r) => r.transformer.serialNumber, width: 18 },
    { header: "Manufacturer", value: (r) => r.manufacturer.name, width: 22 },
    { header: "Rating (kVA)", value: (r) => r.transformer.ratingKva, width: 11 },
    { header: "Fault Date", value: (r) => dmy(r.createdAt), width: 13 },
    { header: "Fault Cause", value: (r) => r.faultReason.split(":")[0], width: 20 },
    { header: "Fault Description", value: (r) => r.faultReason, width: 40 },
    { header: "Location", value: (r) => r.transformer.currentSiteName ?? "", width: 22 },
    { header: "GPS Latitude", value: (r) => gps(r.transformer.currentLat), width: 13 },
    { header: "GPS Longitude", value: (r) => gps(r.transformer.currentLng), width: 13 },
    { header: "Installation Date", value: (r) => dmy(r.transformer.commissionDate), width: 15 },
    { header: "Days in Service", value: (r) => (r.transformer.commissionDate ? Math.max(0, Math.floor((r.createdAt.getTime() - r.transformer.commissionDate.getTime()) / DAY)) : ""), width: 12 },
    { header: "Warranty Start", value: (r) => dmy(r.transformer.warrantyStart), width: 14 },
    { header: "Warranty Expiry", value: (r) => dmy(computeWarranty(r.transformer.warrantyStart, r.transformer.warrantyMonths).expiresAt), width: 14 },
    { header: "Warranty Days Left at Fault", value: (r) => { const w = computeWarranty(r.transformer.warrantyStart, r.transformer.warrantyMonths, r.createdAt); return w.daysRemaining ?? ""; }, width: 14 },
    { header: "Claim Value (KES)", value: (r) => (r.claimValueKes ? Number(r.claimValueKes) : 0), width: 15, numFmt: '"KES" #,##0' },
    { header: "Claim Status", value: (r) => r.status, width: 12 },
    { header: "RMA Reference", value: (r) => r.referenceNo ?? "", width: 16 },
    { header: "Days Open", value: (r) => daysSince(r.createdAt) ?? "", width: 10 },
    { header: "Chain Hash", value: (r) => (r.transformer.lastEventHash ? r.transformer.lastEventHash.slice(-8) : ""), width: 12 },
    { header: "Chain Status", value: (r) => (verifyChain(r.transformer.events as unknown as ChainLink[]).valid ? "Verified" : "BROKEN"), width: 12, tone: (r) => (verifyChain(r.transformer.events as unknown as ChainLink[]).valid ? "ok" : "fail") },
    { header: "Events in Chain", value: (r) => r.transformer.events.length, width: 12 },
  ];
}

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const scope = user.role === "MANAGER" && user.region ? { region: user.region } : {};

    const claims = (await prisma.warrantyClaim.findMany({
      where: { transformer: scope, status: { in: ["OPEN", "SUBMITTED", "APPROVED"] } },
      orderBy: [{ manufacturerId: "asc" }, { createdAt: "desc" }],
      include: {
        manufacturer: { select: { name: true } },
        transformer: {
          select: {
            gNumber: true, serialNumber: true, ratingKva: true, currentLat: true, currentLng: true,
            currentSiteName: true, commissionDate: true, warrantyStart: true, warrantyMonths: true, lastEventHash: true,
            events: { orderBy: { occurredAt: "asc" }, select: { id: true, hash: true, prevHash: true, transformerId: true, type: true, toStatus: true, userId: true, occurredAt: true, lat: true, lng: true, vehiclePlate: true, driverName: true, notes: true } },
          },
        },
      },
    })) as ClaimRow[];

    // Group by manufacturer — one sheet each.
    const byMaker = new Map<string, ClaimRow[]>();
    for (const c of claims) {
      const key = c.manufacturer.name;
      (byMaker.get(key) ?? byMaker.set(key, []).get(key)!).push(c);
    }

    const cols = columns();
    const sheets: XlsxSheet<ClaimRow>[] = [...byMaker.entries()].map(([name, rows]) => ({
      name: name.slice(0, 28), // Excel sheet-name limit is 31 chars
      rows,
      columns: cols,
    }));
    if (sheets.length === 0) sheets.push({ name: "Claims", rows: [], columns: cols });

    const total = claims.reduce((s, c) => s + Number(c.claimValueKes ?? 0), 0);
    const coverLines = [
      `Total open claims: ${claims.length}`,
      `Total recoverable: KES ${total.toLocaleString("en-KE")}`,
      "",
      ...[...byMaker.entries()].map(([name, rows]) => `${name}: ${rows.length} claim${rows.length === 1 ? "" : "s"} · KES ${rows.reduce((s, c) => s + Number(c.claimValueKes ?? 0), 0).toLocaleString("en-KE")}`),
      "",
      "The custody chain hashes on each claim provide arithmetically undeniable",
      "proof of that transformer's complete, unedited history.",
    ];

    const buffer = await toXlsxWorkbook({
      sheets,
      title: "Transformer DNA — Warranty Claim Pack",
      generatedBy: user.name,
      region: user.region ?? "All regions",
      cover: { heading: "Summary of all claims", lines: coverLines },
      footerLines: ["Generated by Transformer DNA. Custody chain hashes provide arithmetically undeniable proof of each transformer's complete history."],
    });
    return xlsx(buffer, "warranty-claim-pack");
  } catch (error) {
    return apiError(error);
  }
}
