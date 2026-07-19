import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";

/**
 * POST /api/transformers/[id]/recover-for-repair
 *
 * The step between a fault and a workshop, and the one the loop cannot work
 * without: a transformer on a pole has not been recovered, and a workshop
 * cannot receive something that has not left site.
 *
 * Distinct from the plain RECOVERED event, which sends a unit back to a store.
 * This one names the workshop as the destination, so a manager can see the
 * difference between "coming back to stock" and "going for repair" without
 * reading notes.
 */

const schema = z.object({
  vehiclePlate: z.string().trim().min(4, "Which vehicle carried it?").max(15),
  driverName: z.string().trim().max(80).optional(),
  destination: z.string().trim().max(120).optional(),
  faultSummary: z.string().trim().max(400).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "STORE_KEEPER", "ADMIN");
    const { id } = await context.params;
    const input = schema.parse(await request.json().catch(() => null));

    const tx = await prisma.transformer.findUnique({
      where: { id },
      select: { id: true, gNumber: true, serialNumber: true, currentSiteName: true },
    });
    if (!tx) return NextResponse.json({ error: "Transformer not found." }, { status: 404 });

    const result = await recordEvent(
      id,
      {
        type: "RECOVERED_FOR_REPAIR",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        vehiclePlate: input.vehiclePlate,
        driverName: input.driverName ?? null,
        destination: input.destination ?? "Workshop",
        notes:
          `Removed from ${tx.currentSiteName ?? "site"} for repair.` +
          (input.faultSummary ? ` Reported fault: ${input.faultSummary}.` : "") +
          (input.notes ? ` ${input.notes}` : ""),
      },
      actor,
    );

    return NextResponse.json(
      {
        eventId: result.eventId,
        status: result.toStatus,
        message: `${tx.gNumber ?? tx.serialNumber} is on its way to the workshop. Book it in on arrival.`,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
