import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { canAssign } from "@/lib/workshop";

/**
 * POST /api/workshop/start — a technician begins work.
 *
 * This one IS a chain event (REPAIR_STARTED). Assignment is a plan; this is the
 * moment somebody opens the transformer, and from here the unit is not in the
 * condition it arrived in. The chain should be able to answer "when was this
 * unit last untouched", and without this event it cannot.
 *
 * The transformer's status does not change — it is AT_WORKSHOP before and
 * after, because custody has not moved. Only the bench status changes.
 */

const schema = z.object({
  repairId: z.string().min(1),
  /** Optional: start work and take the job in one step. */
  technicianId: z.string().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "STORE_MANAGER", "ADMIN");
    const input = schema.parse(await request.json().catch(() => null));

    const repair = await prisma.repairRecord.findUnique({
      where: { id: input.repairId },
      select: {
        id: true,
        status: true,
        technicianId: true,
        startedAt: true,
        repairCompletedAt: true,
        workshopStoreId: true,
        technician: { select: { id: true, name: true } },
        transformer: { select: { id: true, gNumber: true, serialNumber: true, status: true } },
      },
    });
    if (!repair) return NextResponse.json({ error: "Repair record not found." }, { status: 404 });

    const label = repair.transformer.gNumber ?? repair.transformer.serialNumber;

    if (repair.repairCompletedAt || repair.status === "REPAIRED" || repair.status === "BEYOND_REPAIR") {
      return NextResponse.json({ error: "This job is already closed." }, { status: 409 });
    }
    if (repair.status === "IN_REPAIR") {
      return NextResponse.json(
        {
          error: `${repair.technician?.name ?? "Someone"} already started work on ${label} — nothing to start twice.`,
        },
        { status: 409 },
      );
    }

    // Who is doing it. Falls back to whoever is already named on the job.
    const technicianId = input.technicianId ?? repair.technicianId;
    if (!technicianId) {
      return NextResponse.json(
        {
          error:
            "Nobody is assigned to this unit. Name a technician first — a repair with no named technician is a repair nobody is accountable for.",
        },
        { status: 422 },
      );
    }

    // Re-check the one-job rule at the moment of starting, not just at
    // assignment. Two jobs can be assigned to a free technician seconds apart;
    // only the first of them may actually start.
    const verdict = await canAssign(repair.id, technicianId);
    if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 409 });

    const technician = await prisma.user.findUniqueOrThrow({
      where: { id: technicianId },
      select: { id: true, name: true, storeId: true },
    });

    const startedAt = new Date();

    // Chain first. If the state machine refuses the transition, the bench
    // status is not left claiming work began on a unit that cannot be worked.
    const event = await recordEvent(
      repair.transformer.id,
      {
        type: "REPAIR_STARTED",
        occurredAt: startedAt,
        notes:
          `Repair started by ${technician.name}.` + (input.notes ? ` ${input.notes}` : ""),
      },
      actor,
    );

    await prisma.repairRecord.update({
      where: { id: repair.id },
      data: {
        technicianId: technician.id,
        assignedAt: repair.technicianId === technician.id ? undefined : startedAt,
        startedAt,
        status: "IN_REPAIR",
        workshopTechnician: technician.name,
        ...(repair.workshopStoreId ? {} : { workshopStoreId: technician.storeId }),
      },
    });

    return NextResponse.json({
      ok: true,
      status: "IN_REPAIR",
      startedAt,
      eventId: event.eventId,
      technician: { id: technician.id, name: technician.name },
      message: `${technician.name} is now working on ${label}.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
