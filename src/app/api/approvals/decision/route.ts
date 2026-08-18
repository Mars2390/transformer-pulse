import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { requirePinConfirmation } from "@/lib/security/step-up";
import { apiError } from "@/lib/api";
import { approvalDecideSchema } from "@/lib/validation";
import { canApproveForStore } from "@/lib/region-scope";
import { APPROVAL_ACTION_META, canSign, isApprovalAction } from "@/lib/approvals";

/**
 * Signing off, or refusing, one or many requests at once.
 *
 * FIVE THINGS ARE CHECKED PER RECORD, NOT PER REQUEST
 * ---------------------------------------------------
 * A bulk endpoint that validates the caller once and then trusts the whole
 * array is how a bulk feature turns into a privilege escalation. Every id is
 * re-checked against the record it names:
 *
 *   1. it exists and is still PENDING — approving something twice must not
 *      produce two certificates
 *   2. the action is one this role signs, from the catalog
 *   3. a store manager's scope: the unit must be held at THEIR store. Their
 *      scope is a foreign key, not a region, and reusing region logic here
 *      would let a Ruaraka manager sign for every store in Nairobi North
 *   4. maker ≠ checker: you cannot sign your own request
 *   5. the unit still exists
 *
 * Anything that fails comes back as a skipped row with a sentence, and the
 * rest still go through.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiUser();
    const body = await request.json().catch(() => null);
    const input = approvalDecideSchema.parse(body);

    // Before the loop, so a wrong PIN refuses the whole batch rather than half of it.
    await requirePinConfirmation(actor.id, input.pin);
    const decision = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";

    const docs = await prisma.approvalDocument.findMany({
      where: { id: { in: input.approvalIds } },
      include: {
        transformer: {
          select: {
            id: true,
            gNumber: true,
            serialNumber: true,
            currentStoreId: true,
          },
        },
      },
    });
    const byId = new Map(docs.map((d) => [d.id, d]));

    const decided: { id: string; reference: string; label: string }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];

    for (const id of input.approvalIds) {
      const doc = byId.get(id);
      if (!doc) {
        skipped.push({ id, label: id, reason: "Not found." });
        continue;
      }
      const label = `${doc.reference} · ${doc.transformer.gNumber ?? doc.transformer.serialNumber}`;

      if (doc.status !== "PENDING") {
        skipped.push({
          id,
          label,
          reason: `Already ${doc.status.toLowerCase()} — nothing left to decide.`,
        });
        continue;
      }
      if (!isApprovalAction(doc.action)) {
        skipped.push({ id, label, reason: "Unknown action. Raise it again." });
        continue;
      }
      if (!canSign(doc.action, actor.role)) {
        const meta = APPROVAL_ACTION_META[doc.action];
        skipped.push({
          id,
          label,
          reason: `${meta.label} is signed by ${meta.approvers.join(" or ")}.`,
        });
        continue;
      }
      if (!canApproveForStore(actor, doc.transformer.currentStoreId)) {
        skipped.push({ id, label, reason: "Held at another store — their manager signs this." });
        continue;
      }
      if (doc.requestedById === actor.id) {
        skipped.push({
          id,
          label,
          reason: "You raised this one. Somebody else has to sign it.",
        });
        continue;
      }

      // One decision and one audit row, or neither. Two separate writes meant a
      // signature could exist with nothing recording who made it, and for a
      // maker-checker control that record IS the control.
      await prisma.$transaction([
        prisma.approvalDocument.update({
          where: { id: doc.id },
          data: {
            status: decision,
            decidedById: actor.id,
            decidedAt: new Date(),
            decisionNotes: input.notes?.trim() || null,
          },
        }),

        prisma.auditLog.create({
          data: {
            actorId: actor.id,
            action: "EDIT",
            targetType: "Transformer",
            targetId: doc.transformerId,
            targetLabel: doc.transformer.gNumber ?? doc.transformer.serialNumber,
            details: `${decision === "APPROVED" ? "Approved" : "Refused"} ${doc.reference} — ${
              APPROVAL_ACTION_META[doc.action].label
            }.`,
            reason: input.notes?.trim() || undefined,
          },
        }),
      ]);

      decided.push({ id, reference: doc.reference, label });
    }

    const verb = decision === "APPROVED" ? "approved" : "refused";
    const message = decided.length
      ? `${decided.length} request${decided.length === 1 ? "" : "s"} ${verb}${
          skipped.length ? `, ${skipped.length} skipped` : ""
        }. Certificates are ready to download.`
      : "Nothing was decided.";

    return NextResponse.json({ decided, skipped, message }, { status: decided.length ? 200 : 422 });
  } catch (error) {
    return apiError(error);
  }
}
