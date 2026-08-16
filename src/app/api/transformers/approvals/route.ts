import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { approvalDecisionSchema } from "@/lib/validation";
import { regionWhere } from "@/lib/region-scope";

/**
 * POST /api/transformers/approvals — the CHECKER half of maker-checker.
 *
 * A receiving officer books a delivery in and it lands in PENDING_APPROVAL,
 * where the lifecycle engine will not let it be tested or dispatched. This
 * route is the only way out of that state.
 *
 * The rule that matters is that a maker cannot check their own work. It is
 * enforced here, per transformer, by comparing submittedById to the actor —
 * not in the UI, where it would be advice rather than a control. A checker who
 * bulk-selects forty units including three they booked in themselves gets
 * thirty-seven approved and three refused with a reason, rather than an
 * all-or-nothing failure that teaches them to select more carefully next time.
 *
 * Every decision writes two records: a LifecycleEvent, so the chain has no gap
 * between "received" and "in stock", and an AuditLog row, so the question "who
 * let this in" has an answer that does not require reading the chain.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("MANAGER", "ADMIN");

    const body = await request.json().catch(() => null);
    const input = approvalDecisionSchema.parse(body);

    // Region scope applies to approvals exactly as it does to everything else:
    // a manager approves stock for their own region, an admin for all of it.
    const scope = regionWhere(actor.region, actor.role);

    const candidates = await prisma.transformer.findMany({
      where: { id: { in: input.transformerIds }, ...scope },
      select: {
        id: true,
        gNumber: true,
        serialNumber: true,
        status: true,
        submittedById: true,
        submittedBy: { select: { name: true } },
      },
    });

    const found = new Map(candidates.map((c) => [c.id, c]));
    const approved: string[] = [];
    const rejected: string[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];

    for (const id of input.transformerIds) {
      const tx = found.get(id);
      const label = tx?.gNumber ?? tx?.serialNumber ?? id;

      if (!tx) {
        skipped.push({ id, label, reason: "Not found, or outside your region." });
        continue;
      }
      if (tx.status !== "PENDING_APPROVAL") {
        skipped.push({ id, label, reason: `Already ${tx.status.toLowerCase().replace(/_/g, " ")}.` });
        continue;
      }
      // The whole point of the control.
      if (tx.submittedById && tx.submittedById === actor.id) {
        skipped.push({
          id,
          label,
          reason: "You booked this one in. A second person has to approve it.",
        });
        continue;
      }

      const isApprove = input.decision === "APPROVE";
      const reason = input.reason?.trim() || null;

      try {
        await recordEvent(
          id,
          {
            type: isApprove ? "APPROVED_FOR_STOCK" : "REJECTED_ON_INTAKE",
            notes: isApprove
              ? `Approved into stock by ${actor.name}. Booked in by ${tx.submittedBy?.name ?? "an unknown officer"}.${reason ? ` ${reason}` : ""}`
              : `Rejected at intake by ${actor.name}. Booked in by ${tx.submittedBy?.name ?? "an unknown officer"}. Reason: ${reason}`,
          },
          actor,
        );
      } catch (error) {
        skipped.push({
          id,
          label,
          reason: error instanceof Error ? error.message : "Could not record the decision.",
        });
        continue;
      }

      await prisma.$transaction(async (t) => {
        await t.transformer.update({
          where: { id },
          data: {
            approvedById: actor.id,
            approvedAt: new Date(),
            rejectionReason: isApprove ? null : reason,
          },
        });

        await writeAudit(
          {
            actorId: actor.id,
            action: "EDIT",
            targetType: "Transformer",
            targetId: id,
            targetLabel: label,
            details: isApprove
              ? `Manager ${actor.name} approved transformer ${label} into stock (booked in by ${tx.submittedBy?.name ?? "unknown"}).`
              : `Manager ${actor.name} rejected transformer ${label} at intake (booked in by ${tx.submittedBy?.name ?? "unknown"}).`,
            reason: reason ?? undefined,
          },
          t,
        );
      });

      (isApprove ? approved : rejected).push(label);
    }

    const done = approved.length + rejected.length;
    return NextResponse.json({
      approved,
      rejected,
      skipped,
      message:
        done === 0
          ? "Nothing was changed."
          : input.decision === "APPROVE"
            ? `${approved.length} approved into stock.${skipped.length ? ` ${skipped.length} skipped.` : ""}`
            : `${rejected.length} rejected.${skipped.length ? ` ${skipped.length} skipped.` : ""}`,
    });
  } catch (error) {
    return apiError(error);
  }
}
