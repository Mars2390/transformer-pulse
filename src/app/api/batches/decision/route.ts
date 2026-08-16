import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { batchDecisionSchema } from "@/lib/validation";
import { canApproveForStore } from "@/lib/region-scope";
import { stampApproval } from "@/lib/approval-store";

/**
 * POST /api/batches/decision — accept or refuse consignments.
 *
 * One decision, cascaded to every unit as an ordinary APPROVED_FOR_STOCK event
 * through recordEvent. That matters: the chain entry a batch-approved unit
 * carries is identical to the one a singly-approved unit carries, so nothing
 * downstream has to know batches exist.
 *
 * Maker cannot check their own work, exactly as everywhere else: the person who
 * booked the delivery in cannot be the one who releases it. On a sampled batch
 * that rule is doing more work than usual, because approving here releases
 * units nobody has tested.
 *
 * NOW TAKES AN ARRAY, and this was the last queue in the system that could not.
 * Every other approval screen had checkbox multi-select; this one had a button
 * per card, so a manager facing eleven consignments on a Monday clicked eleven
 * times and waited for eleven page refreshes. It now follows the same contract
 * as everything else: array in, `{ decided, skipped, message }` out, PARTIAL
 * APPLY. Ten valid consignments are not thrown away because the eleventh was
 * booked in by the person deciding.
 *
 * `batchId` singular is still accepted, so anything posting the old shape keeps
 * working. This route is the only place that knows two spellings exist.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("MANAGER", "STORE_MANAGER", "ADMIN");
    const input = batchDecisionSchema.parse(await request.json().catch(() => null));
    const isApprove = input.decision === "APPROVE";
    const reason = input.reason?.trim() || null;

    const batchIds = input.batchIds?.length ? input.batchIds : [input.batchId!];

    const batches = await prisma.transformerBatch.findMany({
      where: { id: { in: batchIds } },
      include: {
        manufacturer: { select: { name: true } },
        receivedBy: { select: { id: true, name: true } },
        transformers: {
          select: { id: true, gNumber: true, serialNumber: true, status: true, sampleTested: true },
        },
      },
    });
    const byId = new Map(batches.map((b) => [b.id, b]));

    const decided: { id: string; batchRef: string; released: number; untested: number }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];
    const failed: { label: string; reason: string }[] = [];
    /** Certificate ids, so the caller can print one schedule covering the lot. */
    const approvalIds: string[] = [];

    for (const id of batchIds) {
      const batch = byId.get(id);
      if (!batch) {
        skipped.push({ id, label: id, reason: "Not found." });
        continue;
      }
      // Every rule re-checked per consignment, not once for the request. A bulk
      // endpoint that validates the caller and then trusts the array is how a
      // bulk feature turns into a privilege escalation.
      if (batch.status !== "PENDING_APPROVAL") {
        skipped.push({
          id,
          label: batch.batchRef,
          reason: `Already ${batch.status.toLowerCase().replace(/_/g, " ")}.`,
        });
        continue;
      }
      if (!canApproveForStore(actor, batch.storeId)) {
        skipped.push({
          id,
          label: batch.batchRef,
          reason: "Arrived at another store — its own approver has to decide.",
        });
        continue;
      }
      if (batch.receivedById === actor.id) {
        skipped.push({
          id,
          label: batch.batchRef,
          reason: "You booked this consignment in. A second person has to release it.",
        });
        continue;
      }

      const untested = batch.transformers.filter((t) => !t.sampleTested);
      const released: string[] = [];

      if (isApprove) {
        for (const t of batch.transformers) {
          if (t.status !== "PENDING_APPROVAL") continue;
          const label = t.gNumber ?? t.serialNumber;
          try {
            const result = await recordEvent(
              t.id,
              {
                type: "APPROVED_FOR_STOCK",
                notes: t.sampleTested
                  ? `Released as stock with ${batch.batchRef}. Tested as part of the sample. Approved by ${actor.name}.`
                  : `Released as stock with ${batch.batchRef} WITHOUT being tested, under KPLC sampling policy — ${batch.transformers.length - untested.length} of ${batch.transformers.length} in this consignment were tested. Approved by ${actor.name}.`,
              },
              actor,
            );

            // One certificate per transformer, not one per consignment. The
            // certificate travels in the folder that follows that unit for the
            // next thirty years, and a shared sheet naming eleven other serials
            // is no use in that folder. The consignment gets its own covering
            // schedule from the bulk PDF route.
            const doc = await stampApproval(
              {
                transformerId: t.id,
                action: "STOCK_RELEASE",
                decision: "APPROVED",
                notes: t.sampleTested
                  ? `Released with consignment ${batch.batchRef}. Tested as part of the sample.`
                  : `Released with consignment ${batch.batchRef} under KPLC sampling policy. THIS UNIT WAS NOT TESTED.`,
                batchId: batch.id,
                eventId: result.eventId,
                chainHash: result.hash,
                contextLabel: `Consignment ${batch.batchRef}`,
              },
              actor,
            );
            approvalIds.push(doc.id);

            released.push(label);
          } catch (error) {
            failed.push({
              label,
              reason: error instanceof Error ? error.message : "Could not release.",
            });
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.transformerBatch.update({
          where: { id: batch.id },
          data: {
            status: isApprove ? "APPROVED" : "REJECTED",
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
            targetId: batch.id,
            targetLabel: batch.batchRef,
            details: isApprove
              ? `${actor.name} released ${batch.batchRef} (${batch.manufacturer.name}) into stock: ${released.length} units, of which ${untested.length} were NEVER TESTED and are released on the sample. Booked in by ${batch.receivedBy.name}.`
              : `${actor.name} refused ${batch.batchRef} (${batch.manufacturer.name}). Booked in by ${batch.receivedBy.name}.`,
            reason: reason ?? undefined,
          },
          tx,
        );
      });

      decided.push({
        id: batch.id,
        batchRef: batch.batchRef,
        released: released.length,
        untested: isApprove ? untested.length : 0,
      });
    }

    const totalReleased = decided.reduce((n, d) => n + d.released, 0);
    const totalUntested = decided.reduce((n, d) => n + d.untested, 0);

    const message = decided.length
      ? isApprove
        ? `${decided.length} consignment${decided.length === 1 ? "" : "s"} released — ${totalReleased} units into stock, ${totalUntested} of them never tested.${skipped.length ? ` ${skipped.length} skipped.` : ""}`
        : `${decided.length} consignment${decided.length === 1 ? "" : "s"} refused.${skipped.length ? ` ${skipped.length} skipped.` : ""}`
      : "Nothing was decided.";

    return NextResponse.json(
      {
        decided,
        skipped,
        failed,
        approvalIds,
        // Kept so anything still reading the old single-batch response shape
        // finds what it expects rather than silently seeing undefined.
        batchRef: decided[0]?.batchRef ?? null,
        released: totalReleased,
        untestedReleased: totalUntested,
        message,
      },
      { status: decided.length ? 200 : 422 },
    );
  } catch (error) {
    return apiError(error);
  }
}
