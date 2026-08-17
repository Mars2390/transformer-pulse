import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { canAssign, listTechnicians } from "@/lib/workshop";

/**
 * POST /api/workshop/assign — name the technician who will do the work.
 *
 * Assignment is NOT a chain event. The custody chain records changes of custody
 * and state, and naming a person changes neither: the transformer is at the
 * workshop before and after, in the same condition, held by the same store.
 * Writing it to the chain would dilute the one record whose whole value is that
 * every entry in it is a real change to the asset.
 *
 * It is audited instead, which is the right home for "who decided what, when".
 * REPAIR_STARTED — the moment work actually begins — IS on the chain, because
 * that is when something starts happening to the transformer.
 */

const schema = z.object({
  repairId: z.string().min(1),
  /** Null or absent means "put it back in the queue". */
  technicianId: z.string().min(1).nullable().optional(),
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
        workshopStoreId: true,
        transformer: { select: { id: true, gNumber: true, serialNumber: true } },
      },
    });
    if (!repair) return NextResponse.json({ error: "Repair record not found." }, { status: 404 });

    const label = repair.transformer.gNumber ?? repair.transformer.serialNumber;

    // --- Unassign: back to the queue ----------------------------------------
    if (!input.technicianId) {
      if (repair.status === "IN_REPAIR") {
        return NextResponse.json(
          {
            error:
              "Work has already started on this unit. Record the outcome rather than sending a half-opened transformer back to the queue.",
          },
          { status: 409 },
        );
      }

      await prisma.repairRecord.update({
        where: { id: repair.id },
        data: { technicianId: null, assignedAt: null, status: "QUEUED" },
      });

      await writeAudit({
        actorId: actor.id,
        action: "EDIT",
        targetType: "Transformer",
        targetId: repair.transformer.id,
        targetLabel: label,
        details: "Workshop: returned to the queue, technician unassigned.",
      });

      return NextResponse.json({ ok: true, status: "QUEUED", queued: true });
    }

    // --- Assign -------------------------------------------------------------
    const verdict = await canAssign(repair.id, input.technicianId);
    if (!verdict.ok) {
      // 409, not 422: nothing about the request is malformed. The floor is in a
      // state that does not allow it, and the caller should show the reason.
      const technicians = await listTechnicians(repair.workshopStoreId);
      return NextResponse.json(
        {
          error: verdict.reason,
          available: technicians.filter((t) => t.available).map((t) => ({ id: t.id, name: t.name })),
        },
        { status: 409 },
      );
    }

    const technician = await prisma.user.findUniqueOrThrow({
      where: { id: input.technicianId },
      select: { id: true, name: true, storeId: true },
    });

    const assignedAt = new Date();
    await prisma.repairRecord.update({
      where: { id: repair.id },
      data: {
        technicianId: technician.id,
        assignedAt,
        status: "QUEUED", // assigned, but not started — see startedAt
        // Backfill the workshop key from the technician when the unit was
        // booked in before workshops were tracked by id.
        ...(repair.workshopStoreId ? {} : { workshopStoreId: technician.storeId }),
      },
    });

    await writeAudit({
      actorId: actor.id,
      action: "EDIT",
      targetType: "Transformer",
      targetId: repair.transformer.id,
      targetLabel: label,
      details: `Workshop: assigned to technician ${technician.name}.`,
    });

    return NextResponse.json({
      ok: true,
      status: "QUEUED",
      technician: { id: technician.id, name: technician.name },
      assignedAt,
      message: `${label} assigned to ${technician.name}. It stays in the queue until they start work.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
