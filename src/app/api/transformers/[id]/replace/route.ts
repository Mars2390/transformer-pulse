import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent, LifecycleError } from "@/lib/events";
import { replaceSchema } from "@/lib/field-validation";

/**
 * POST /api/transformers/[id]/replace — swap a faulty unit for a new one.
 *
 * Two events, on two different transformers, tied together:
 *   old unit → RECOVERED  (leaves site, heads back to store)
 *   new unit → INSTALLED  (energised in its place)
 *
 * We record the old unit's RECOVERED first so its event id exists, then pass
 * that id as `linkedEventId` on the new unit's INSTALLED. Each recordEvent call
 * is its own transaction and its own chain — that is correct, because the two
 * transformers have SEPARATE custody chains. The link is a cross-reference
 * between them, not a shared hash.
 *
 * If the second call fails, the first has already committed. We surface that
 * honestly rather than pretend it was atomic: the old unit is recovered, the
 * new one is not yet installed, and the message says exactly that.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const { id: oldId } = await context.params;
    const input = replaceSchema.parse(await request.json().catch(() => null));

    if (input.newTransformerId === oldId) {
      return NextResponse.json(
        { error: "The replacement must be a different transformer." },
        { status: 422 },
      );
    }

    // The new unit must be one that can actually be installed — on site and
    // received, or still in transit to here. Check before we touch anything.
    const newUnit = await prisma.transformer.findUnique({
      where: { id: input.newTransformerId },
      select: { id: true, status: true, gNumber: true, serialNumber: true },
    });
    if (!newUnit) {
      return NextResponse.json({ error: "Replacement transformer not found." }, { status: 404 });
    }

    // Step 1: recover the old unit.
    const recovered = await recordEvent(
      oldId,
      {
        type: "RECOVERED",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        vehiclePlate: "PENDING", // recovery vehicle recorded at the store on return
        driverName: null,
        photoUrls: input.oldPhotoUrls ?? [],
        notes: `Removed and replaced by ${newUnit.gNumber ?? newUnit.serialNumber}.`,
      },
      actor,
    ).catch((error) => {
      if (error instanceof LifecycleError) {
        throw new LifecycleError(
          `The faulty unit cannot be recovered: ${error.message}`,
          error.status,
        );
      }
      throw error;
    });

    // Step 2: install the new unit, linked back to the recovery.
    let installed;
    try {
      installed = await recordEvent(
        input.newTransformerId,
        {
          type: "INSTALLED",
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          accuracyM: input.accuracyM ?? null,
          siteName: input.siteName,
          locationName: input.siteName,
          region: actor.region ?? null,
          photoUrls: input.newPhotoUrls,
          notes: input.notes || `Installed in place of the recovered unit at ${input.siteName}.`,
          test: { ...input.test, stage: "SITE_COMMISSIONING" },
          linkedEventId: recovered.eventId,
        },
        actor,
      );
    } catch (error) {
      const detail = error instanceof LifecycleError ? error.message : "unexpected error";
      throw new LifecycleError(
        `The old unit was recovered, but the new unit could not be installed (${detail}). Install ${newUnit.gNumber ?? newUnit.serialNumber} separately to finish the swap.`,
        409,
      );
    }

    // Close the link the other way, so the old unit's story also says
    // "replaced by …". This is a plain cross-reference, not part of any hash.
    await prisma.lifecycleEvent.update({
      where: { id: recovered.eventId },
      data: { linkedEventId: installed.eventId },
    });

    return NextResponse.json({ ok: true, alerts: installed.alerts });
  } catch (error) {
    return apiError(error);
  }
}
