import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile } from "@/components/ui";
import { ClaimsTable, type ClaimRow } from "@/components/manager/ClaimsTable";
import { computeWarranty } from "@/lib/warranty";
import { formatKesCompact, formatNumber } from "@/lib/format";
import { regionWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Warranty claims" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function WarrantyPage() {
  const user = await requireRole("MANAGER", "ADMIN");
  const scope = regionWhere(user.region, user.role);

  const claims = await prisma.warrantyClaim.findMany({
    where: { transformer: scope },
    orderBy: { createdAt: "desc" },
    include: {
      manufacturer: { select: { name: true } },
      transformer: {
        select: { id: true, gNumber: true, serialNumber: true, warrantyStart: true, warrantyMonths: true },
      },
    },
  });

  const rows: ClaimRow[] = claims.map((c) => {
    const w = computeWarranty(c.transformer.warrantyStart, c.transformer.warrantyMonths);
    return {
      id: c.id,
      gNumber: c.transformer.gNumber ?? c.transformer.serialNumber,
      transformerId: c.transformer.id,
      manufacturer: c.manufacturer.name,
      faultReason: c.faultReason,
      faultDateISO: c.createdAt.toISOString(),
      warrantyExpiryISO: w.expiresAt?.toISOString() ?? null,
      claimValueKes: c.claimValueKes ? Number(c.claimValueKes) : null,
      status: c.status,
      daysSinceRaised: Math.floor((Date.now() - c.createdAt.getTime()) / DAY),
      referenceNo: c.referenceNo,
    };
  });

  const open = rows.filter((r) => r.status === "OPEN" || r.status === "SUBMITTED");
  const recoverable = open.reduce((s, r) => s + (r.claimValueKes ?? 0), 0);
  const settled = rows.filter((r) => r.status === "CLOSED").reduce((s, r) => s + (r.claimValueKes ?? 0), 0);
  const expiringSoon = open.filter((r) => {
    if (!r.warrantyExpiryISO) return false;
    const days = (new Date(r.warrantyExpiryISO).getTime() - Date.now()) / DAY;
    return days > 0 && days <= 30;
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/manager/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Warranty claims</h1>
          <p className="mt-1 text-sm text-ink-soft">Money owed to KPLC by manufacturers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/pdf/warranty-pack"
            className="rounded-xl bg-gold px-4 py-2.5 text-xs font-bold text-navy-dark shadow-lg shadow-gold/20 transition-colors hover:bg-gold-dark"
          >
            Export claim pack (PDF)
          </a>
          <a
            href="/api/reports/warranty-pack?format=xlsx"
            className="rounded-xl border border-line bg-white px-4 py-2.5 text-xs font-bold text-navy transition-colors hover:border-navy/30"
          >
            XLSX
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Open claims" value={formatNumber(open.length)} tone="warning" />
        <StatTile label="Recoverable" value={formatKesCompact(recoverable)} tone="warning" hint="From open claims" />
        <StatTile label="Expiring ≤30d" value={formatNumber(expiringSoon)} tone={expiringSoon ? "danger" : "neutral"} />
        <StatTile label="Recovered" value={formatKesCompact(settled)} tone="success" hint="Claims settled" />
      </div>

      <Card>
        <CardHeader title={`All claims (${rows.length})`} />
        <ClaimsTable rows={rows} />
      </Card>
    </div>
  );
}
