import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { approvalRequestSchema } from "@/lib/validation";
import { visibleTransformerWhere } from "@/lib/region-scope";
import { openApproval } from "@/lib/approval-store";
import { APPROVAL_ACTION_META, canRequest, isApprovalAction } from "@/lib/approvals";

/**
 * Raising a request for approval.
 *
 * Follows the contract every other decision endpoint in this codebase uses:
 * an array in, `{ created, skipped: {id,label,reason}[], message }` out, and
 * PARTIAL APPLY — twenty valid requests are not thrown away because the
 * twenty-first is ineligible. The alternative, all-or-nothing, teaches people
 * to select one row at a time, which is how a bulk screen becomes theatre.
 *
 * A skipped row always carries a sentence a person can act on. "Skipped: 3"
 * with no reasons is the failure mode that makes somebody re-select the same
 * three rows and press the button again.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiUser();
    const body = await request.json().catch(() => null);
    const input = approvalRequestSchema.parse(body);

    if (!isApprovalAction(input.action)) {
      return NextResponse.json({ error: "That is not an approvable action." }, { status: 422 });
    }
    const action = input.action;
    const meta = APPROVAL_ACTION_META[action];

    if (!canRequest(action, actor.role)) {
      return NextResponse.json(
        {
          error: `${meta.label} is requested by ${meta.requesters.join(" or ")}, not by you.`,
        },
        { status: 403 },
      );
    }

    // `emergency` is never taken from the client here. The only path that may
    // set it is the install route, which sets it server-side after checking
    // the unit is actually replacing a failed one. A flag that downgrades
    // scrutiny must not be settable by whoever is being scrutinised.
    const units = await prisma.transformer.findMany({
      where: { AND: [{ id: { in: input.transformerIds } }, visibleTransformerWhere(actor)] },
      select: {
        id: true,
        gNumber: true,
        serialNumber: true,
        status: true,
        currentSiteName: true,
        currentStore: { select: { name: true } },
      },
    });

    const found = new Map(units.map((u) => [u.id, u]));
    const created: { id: string; reference: string; label: string }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];

    for (const id of input.transformerIds) {
      const unit = found.get(id);
      if (!unit) {
        skipped.push({ id, label: id, reason: "Not found, or outside what you can see." });
        continue;
      }
      const label = unit.gNumber ?? unit.serialNumber;

      const already = await prisma.approvalDocument.findFirst({
        where: { transformerId: id, action, status: { in: ["PENDING", "APPROVED"] }, eventId: null },
        select: { reference: true, status: true },
      });
      if (already) {
        skipped.push({
          id,
          label,
          reason:
            already.status === "PENDING"
              ? `Already waiting on ${already.reference}.`
              : `Already approved on ${already.reference} — go ahead and do it.`,
        });
        continue;
      }

      const doc = await openApproval(
        {
          action,
          transformerId: id,
          justification: input.justification,
          contextLabel:
            input.contextLabel ||
            unit.currentSiteName ||
            unit.currentStore?.name ||
            null,
        },
        actor,
      );
      created.push({ id, reference: doc.reference, label });
    }

    const message = created.length
      ? `${created.length} request${created.length === 1 ? "" : "s"} raised${
          skipped.length ? `, ${skipped.length} skipped` : ""
        }. ${meta.approvers.join(" or ")} will sign off.`
      : "Nothing was raised.";

    return NextResponse.json({ created, skipped, message }, { status: created.length ? 201 : 422 });
  } catch (error) {
    return apiError(error);
  }
}
