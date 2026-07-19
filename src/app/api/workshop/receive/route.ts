import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";

/**
 * POST /api/workshop/receive — book a transformer in at the workshop.
 *
 * Opens a RepairRecord and writes RECEIVED_AT_WORKSHOP on the chain. The
 * received time matters beyond bookkeeping: turnaround is measured from here,
 * and turnaround is how long a site stays dark.
 */

const schema = z.object({
  transformerId: z.string().min(1),
  workshopName: z.string().trim().max(120).optional(),
  faultCauseReported: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const input = schema.parse(await request.json().catch(() => null));

    const tx = await prisma.transformer.findUnique({
      where: { id: input.transformerId },
      select: { id: true, gNumber: true, serialNumber: true, status: true },
    });
    if (!tx) return NextResponse.json({ error: "Transformer not found." }, { status: 404 });

    // Refuse a second open repair. A unit cannot be on two benches at once, and
    // two open records would make turnaround meaningless.
    const open = await prisma.repairRecord.findFirst({
      where: { transformerId: tx.id, repairCompletedAt: null },
      select: { id: true },
    });
    if (open) {
      return NextResponse.json(
        { error: "This transformer already has an open repair.", repairId: open.id },
        { status: 409 },
      );
    }

    const receivedAt = new Date();

    // The chain event first — if the transition is illegal the state machine
    // refuses it and no orphan repair record is left behind.
    const event = await recordEvent(
      tx.id,
      {
        type: "RECEIVED_AT_WORKSHOP",
        occurredAt: receivedAt,
        notes:
          `Booked in at ${input.workshopName ?? "the workshop"}.` +
          (input.faultCauseReported ? ` Reported fault: ${input.faultCauseReported}.` : ""),
      },
      actor,
    );

    const repair = await prisma.repairRecord.create({
      data: {
        transformerId: tx.id,
        lifecycleEventId: event.eventId,
        receivedAtWorkshop: receivedAt,
        workshopName: input.workshopName ?? null,
        faultCauseReported: input.faultCauseReported ?? null,
        notes: input.notes ?? null,
      },
    });

    return NextResponse.json({ repairId: repair.id, eventId: event.eventId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
