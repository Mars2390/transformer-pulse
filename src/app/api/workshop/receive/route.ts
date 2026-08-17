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
  /** The workshop as a Store id. Preferred over the free-text name below. */
  workshopStoreId: z.string().min(1).optional(),
  workshopName: z.string().trim().max(120).optional(),
  faultCauseReported: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "STORE_MANAGER", "ADMIN");
    const input = schema.parse(await request.json().catch(() => null));

    // Resolve the workshop to a real Store row when one was named, so the bench
    // is scopeable. Falls back to the booking-in officer's own store, which for
    // a workshop keeper is the workshop they are standing in.
    const workshop = await prisma.store.findFirst({
      where: {
        kind: "WORKSHOP",
        active: true,
        ...(input.workshopStoreId
          ? { id: input.workshopStoreId }
          : actor.storeId
            ? { id: actor.storeId }
            : {}),
      },
      select: { id: true, name: true },
    });

    if (input.workshopStoreId && !workshop) {
      return NextResponse.json(
        { error: "That workshop does not exist, or is no longer active." },
        { status: 422 },
      );
    }

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
          `Booked in at ${workshop?.name ?? input.workshopName ?? "the workshop"}.` +
          (input.faultCauseReported ? ` Reported fault: ${input.faultCauseReported}.` : ""),
      },
      actor,
    );

    // Custody moves to the workshop.
    //
    // Without this the transformer is at a workshop by status but held by
    // nobody by foreign key, and canMove() then refuses WORKSHOP_TO_STORE with
    // "Not held at any store, so there is nothing for you to load" — a repaired
    // unit that physically cannot be sent back to stock. Booking a unit in IS
    // a change of custody, and the record has to say so.
    if (workshop) {
      await prisma.transformer.update({
        where: { id: tx.id },
        data: { currentStoreId: workshop.id },
      });
    }

    const repair = await prisma.repairRecord.create({
      data: {
        transformerId: tx.id,
        lifecycleEventId: event.eventId,
        receivedAtWorkshop: receivedAt,
        // Arrives in the queue. Nobody is working on it until somebody says so —
        // which is the whole point of the bench status existing.
        status: "QUEUED",
        workshopStoreId: workshop?.id ?? null,
        workshopName: workshop?.name ?? input.workshopName ?? null,
        faultCauseReported: input.faultCauseReported ?? null,
        notes: input.notes ?? null,
      },
    });

    return NextResponse.json(
      {
        repairId: repair.id,
        eventId: event.eventId,
        status: "QUEUED",
        workshop: workshop ? { id: workshop.id, name: workshop.name } : null,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
