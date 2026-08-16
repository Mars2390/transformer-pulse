import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile } from "@/components/ui";
import { BatchApprovals, type PendingBatch } from "@/components/manager/BatchApprovals";
import { canApproveForStore } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Batch approvals" };
export const dynamic = "force-dynamic";

export default async function BatchApprovalsPage() {
  const user = await requireRole("MANAGER", "STORE_MANAGER", "ADMIN");

  const pending = await prisma.transformerBatch.findMany({
    where: {
      status: "PENDING_APPROVAL",
      ...(user.role === "STORE_MANAGER" && user.storeId ? { storeId: user.storeId } : {}),
    },
    orderBy: { receivedAt: "asc" },
    include: {
      manufacturer: { select: { name: true } },
      store: { select: { name: true } },
      receivedBy: { select: { id: true, name: true } },
      transformers: {
        select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, sampleTested: true },
        orderBy: { gNumber: "asc" },
      },
    },
  });

  const batches: PendingBatch[] = pending.map((b) => {
    const tested = b.transformers.filter((t) => t.sampleTested).length;
    const ownIt = b.receivedById === user.id;
    const rightStore = canApproveForStore(user, b.storeId);
    return {
      id: b.id,
      batchRef: b.batchRef,
      manufacturerName: b.manufacturer.name,
      storeName: b.store?.name ?? null,
      declared: b.totalCount,
      entered: b.transformers.length,
      tested,
      untested: b.transformers.length - tested,
      receivedByName: b.receivedBy.name,
      receivedAt: b.receivedAt.toISOString(),
      notes: b.notes,
      canApprove: rightStore && !ownIt,
      blockedReason: ownIt
        ? "You booked this consignment in. A second person has to release it."
        : rightStore
          ? null
          : "This arrived at another store. Its own approver has to decide.",
      units: b.transformers.map((t) => ({
        id: t.id,
        label: t.gNumber ?? t.serialNumber,
        ratingKva: t.ratingKva,
        sampleTested: t.sampleTested,
      })),
    };
  });

  const totalUntested = batches.reduce((n, b) => n + b.untested, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Batch approvals</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Whole consignments waiting to be released. Approving one releases every unit in it,
          including the ones nobody tested.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Consignments waiting" value={String(batches.length)} tone={batches.length ? "warning" : "neutral"} />
        <StatTile label="Units in them" value={String(batches.reduce((n, b) => n + b.entered, 0))} />
        <StatTile label="Never tested" value={String(totalUntested)} tone={totalUntested ? "danger" : "neutral"} />
      </div>

      <Card>
        <CardHeader title="Awaiting a decision" />
        <div className="p-4">
          <BatchApprovals batches={batches} />
        </div>
      </Card>
    </div>
  );
}
