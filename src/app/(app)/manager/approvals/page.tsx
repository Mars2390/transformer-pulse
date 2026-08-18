import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile } from "@/components/ui";
import { ApprovalQueue, type PendingUnit } from "@/components/manager/ApprovalQueue";
import { visibleTransformerWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

/**
 * The checker's desk.
 *
 * Everything a receiving officer books in lands here first. Until a second
 * person accepts it, the unit is not stock: DISPATCHED and TESTED both require
 * IN_STORE, so the lifecycle engine — not this page — is what actually holds
 * it. This page is where somebody does something about it.
 */
export default async function ApprovalsPage() {
  const user = await requireRole("MANAGER", "STORE_MANAGER", "ADMIN");
  // A store manager sees ONE store, by foreign key. A manager sees a region,
  // by free-text match. Those are different questions and share no code path.
  const scope = visibleTransformerWhere(user);

  const [pending, rejectedCount, approvedThisWeek] = await Promise.all([
    prisma.transformer.findMany({
      where: { ...scope, status: "PENDING_APPROVAL" },
      orderBy: { submittedAt: "asc" }, // oldest first — the longest wait is the most urgent
      select: {
        id: true,
        gNumber: true,
        serialNumber: true,
        ratingKva: true,
        submittedById: true,
        submittedAt: true,
        manufacturer: { select: { name: true } },
        currentStore: { select: { name: true } },
        submittedBy: { select: { name: true } },
      },
    }),
    prisma.transformer.count({ where: { ...scope, status: "REJECTED" } }),
    prisma.transformer.count({
      where: {
        ...scope,
        approvedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        status: { not: "REJECTED" },
      },
    }),
  ]);

  const units: PendingUnit[] = pending.map((t) => ({
    id: t.id,
    gNumber: t.gNumber,
    serialNumber: t.serialNumber,
    ratingKva: t.ratingKva,
    manufacturerName: t.manufacturer.name,
    storeName: t.currentStore?.name ?? null,
    submittedByName: t.submittedBy?.name ?? null,
    submittedById: t.submittedById,
    submittedAt: t.submittedAt?.toISOString() ?? null,
  }));

  const oldest = pending[0]?.submittedAt ?? null;
  const waitingDays = oldest
    ? Math.floor((Date.now() - oldest.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Approvals</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Deliveries booked in by a receiving officer, waiting for a second person to accept them
          into stock. You cannot approve a unit you booked in yourself.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Awaiting approval" value={String(units.length)} tone={units.length ? "warning" : "neutral"} />
        <StatTile label="Longest wait" value={units.length ? `${waitingDays}d` : "—"} />
        <StatTile label="Approved this week" value={String(approvedThisWeek)} />
        <StatTile label="Rejected" value={String(rejectedCount)} tone={rejectedCount ? "danger" : "neutral"} />
      </div>

      <Card>
        <CardHeader title="Pending approval" />
        <div className="p-4">
          <ApprovalQueue units={units} viewerId={user.id} />
        </div>
      </Card>
    </div>
  );
}
