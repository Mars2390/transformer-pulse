import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { requirePinConfirmation } from "@/lib/security/step-up";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { transactionDecisionSchema } from "@/lib/validation";
import { MOVEMENTS, type MovementKey } from "@/lib/transactions";
import { canApproveForStore } from "@/lib/region-scope";
import { MOVEMENT_ACTION } from "@/lib/approvals";
import { stampApproval } from "@/lib/approval-store";

/**
 * POST /api/transactions/decision — approve or refuse raised movements, in bulk.
 *
 * Maker cannot check their own work, exactly as with intake approvals: the
 * comparison is initiatedById against the actor, per record, server side. That
 * includes the warranty-return case where a manager raises and a manager
 * approves — it simply has to be a different manager, and the audit row names
 * both.
 *
 * A mixed selection is applied partially. A checker who selects forty and owns
 * three of them gets thirty-seven decided and three refused with reasons,
 * rather than an all-or-nothing failure that teaches them to select carefully
 * instead of correctly.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiUser();

    const body = await request.json().catch(() => null);
    const input = transactionDecisionSchema.parse(body);

    // Before the loop, so a wrong PIN refuses the whole batch rather than half of it.
    await requirePinConfirmation(actor.id, input.pin);
    const isApprove = input.decision === "APPROVE";
    const reason = input.reason?.trim() || null;

    const records = await prisma.transactionRecord.findMany({
      where: { id: { in: input.transactionIds } },
      include: {
        transformer: { select: { id: true, gNumber: true, serialNumber: true } },
        initiatedBy: { select: { name: true } },
      },
    });
    const byId = new Map(records.map((r) => [r.id, r]));

    const decided: string[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];

    for (const id of input.transactionIds) {
      const r = byId.get(id);
      const label = r ? `${r.transformer.gNumber ?? r.transformer.serialNumber} (${r.fromName} → ${r.toName})` : id;

      if (!r) {
        skipped.push({ id, label, reason: "Not found." });
        continue;
      }
      if (r.status !== "PENDING_APPROVAL") {
        skipped.push({ id, label, reason: `Already ${r.status.toLowerCase().replace(/_/g, " ")}.` });
        continue;
      }

      const movement = MOVEMENTS[r.movement as MovementKey];
      if (!movement) {
        skipped.push({ id, label, reason: "Unknown movement type." });
        continue;
      }
      if (!movement.approvers.includes(actor.role)) {
        skipped.push({ id, label, reason: `Your role cannot approve a ${movement.label} movement.` });
        continue;
      }
      // A store manager authorises movements touching their own store — one
      // end or the other. A movement between two other stores is none of their
      // business, and the approvers list in transactions.ts cannot express that
      // because it does not know which store.
      if (
        actor.role === "STORE_MANAGER" &&
        !canApproveForStore(actor, r.fromId) &&
        !canApproveForStore(actor, r.toId)
      ) {
        skipped.push({ id, label, reason: "Neither end of this movement is your store." });
        continue;
      }

      if (r.initiatedById === actor.id) {
        skipped.push({ id, label, reason: "You raised this one. A second person has to approve it." });
        continue;
      }

      await prisma.transactionRecord.update({
        where: { id },
        data: {
          status: isApprove ? "APPROVED" : "REJECTED",
          approvedById: actor.id,
          approvedAt: new Date(),
          rejectionReason: isApprove ? null : reason,
        },
      });

      await writeAudit({
        actorId: actor.id,
        action: "EDIT",
        targetType: "Transformer",
        targetId: r.transformer.id,
        targetLabel: r.transformer.gNumber ?? r.transformer.serialNumber,
        details: isApprove
          ? `${actor.name} approved a ${movement.label} movement raised by ${r.initiatedBy.name} (${r.fromName} → ${r.toName}).`
          : `${actor.name} refused a ${movement.label} movement raised by ${r.initiatedBy.name} (${r.fromName} → ${r.toName}).`,
        reason: reason ?? undefined,
      });

      // Stamp the paperwork the movement raised. No chain hash yet — a
      // movement's lifecycle event is not written until the lorry ARRIVES
      // (see the leg route), which can be days later. The certificate says so
      // rather than printing a blank where a hash should be.
      await stampApproval(
        {
          transformerId: r.transformer.id,
          action: MOVEMENT_ACTION[movement.key],
          decision: isApprove ? "APPROVED" : "REJECTED",
          notes: reason,
          transactionId: r.id,
          contextLabel: `${r.fromName} to ${r.toName}`,
        },
        actor,
      );

      decided.push(label);
    }

    return NextResponse.json({
      decided,
      skipped,
      message: decided.length
        ? `${decided.length} ${isApprove ? "approved" : "refused"}.${skipped.length ? ` ${skipped.length} skipped.` : ""}`
        : "Nothing was changed.",
    });
  } catch (error) {
    return apiError(error);
  }
}
