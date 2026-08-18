import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader } from "@/components/ui";
import { TransactionApprovals, type PendingMovement } from "@/components/transactions/TransactionApprovals";
import { MOVEMENTS, type MovementKey } from "@/lib/transactions";

export const metadata: Metadata = { title: "Movement approvals" };
export const dynamic = "force-dynamic";

export default async function TransactionApprovalsPage() {
  const user = await requireRole("MANAGER", "STORE_MANAGER", "ADMIN");

  const pending = await prisma.transactionRecord.findMany({
    where: {
      status: "PENDING_APPROVAL",
      // A store manager only sees movements with their store at one end.
      ...(user.role === "STORE_MANAGER" && user.storeId
        ? { OR: [{ fromId: user.storeId }, { toId: user.storeId }] }
        : {}),
    },
    orderBy: { initiatedAt: "asc" },
    include: {
      transformer: { select: { id: true, gNumber: true, serialNumber: true } },
      initiatedBy: { select: { id: true, name: true } },
    },
  });

  const movements: PendingMovement[] = pending.map((r) => {
    const m = MOVEMENTS[r.movement as MovementKey];
    const ownIt = r.initiatedById === user.id;
    const roleOk = m ? m.approvers.includes(user.role) : false;
    return {
      id: r.id,
      transformerId: r.transformer.id,
      label: r.transformer.gNumber ?? r.transformer.serialNumber,
      movementLabel: m?.label ?? r.movement,
      fromName: r.fromName,
      toName: r.toName,
      purpose: r.purpose,
      vehiclePlate: r.vehiclePlate,
      driverName: r.driverName,
      initiatedByName: r.initiatedBy.name,
      initiatedById: r.initiatedById,
      initiatedAt: r.initiatedAt.toISOString(),
      batchRef: r.batchRef,
      notes: r.notes,
      canApprove: roleOk && !ownIt,
      blockedReason: ownIt
        ? "You raised this one. A second person has to approve it."
        : roleOk
          ? null
          : "Your role cannot approve this kind of movement.",
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/transactions" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← All movements
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Movement approvals</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Nothing physically moves until one of these is approved, and nobody approves their own.
        </p>
      </div>
      <Card>
        <CardHeader title={`Awaiting a decision (${movements.length})`} />
        <div className="p-4">
          <TransactionApprovals movements={movements} />
        </div>
      </Card>
    </div>
  );
}
