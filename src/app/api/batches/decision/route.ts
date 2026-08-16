import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { batchDecisionSchema } from "@/lib/validation";
import { canApproveForStore } from "@/lib/region-scope";

/**
 * POST /api/batches/decision — accept or refuse a whole consignment.
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
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("MANAGER", "STORE_MANAGER", "ADMIN");
    const input = batchDecisionSchema.parse(await request.json().catch(() => null));
    const isApprove = input.decision === "APPROVE";
    const reason = input.reason?.trim() || null;

    const batch = await prisma.transformerBatch.findUnique({
      where: { id: input.batchId },
      include: {
        manufacturer: { select: { name: true } },
        receivedBy: { select: { id: true, name: true } },
        transformers: { select: { id: true, gNumber: true, serialNumber: true, status: true, sampleTested: true } },
      },
    });
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });

    if (batch.status !== "PENDING_APPROVAL") {
      return NextResponse.json(
        { error: `${batch.batchRef} is already ${batch.status.toLowerCase().replace(/_/g, " ")}.` },
        { status: 409 },
      );
    }
    if (!canApproveForStore(actor, batch.storeId)) {
      return NextResponse.json(
        { error: "That consignment arrived at another store. Its own approver has to decide." },
        { status: 403 },
      );
    }
    if (batch.receivedById === actor.id) {
      return NextResponse.json(
        { error: "You booked this consignment in. A second person has to release it." },
        { status: 409 },
      );
    }

    const untested = batch.transformers.filter((t) => !t.sampleTested);
    const released: string[] = [];
    const failed: { label: string; reason: string }[] = [];

    if (isApprove) {
      for (const t of batch.transformers) {
        if (t.status !== "PENDING_APPROVAL") continue;
        const label = t.gNumber ?? t.serialNumber;
        try {
          await recordEvent(
            t.id,
            {
              type: "APPROVED_FOR_STOCK",
              notes: t.sampleTested
                ? `Released as stock with ${batch.batchRef}. Tested as part of the sample. Approved by ${actor.name}.`
                : `Released as stock with ${batch.batchRef} WITHOUT being tested, under KPLC sampling policy — ${batch.transformers.length - untested.length} of ${batch.transformers.length} in this consignment were tested. Approved by ${actor.name}.`,
            },
            actor,
          );
          released.push(label);
        } catch (error) {
          failed.push({ label, reason: error instanceof Error ? error.message : "Could not release." });
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

    return NextResponse.json({
      batchRef: batch.batchRef,
      released: released.length,
      untestedReleased: isApprove ? untested.length : 0,
      failed,
      message: isApprove
        ? `${batch.batchRef} released. ${released.length} units into stock, ${untested.length} of them never tested.`
        : `${batch.batchRef} refused.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
