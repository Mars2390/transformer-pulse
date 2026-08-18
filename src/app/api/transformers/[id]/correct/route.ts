import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { correctTransformerSchema } from "@/lib/validation";
import { distanceKm } from "@/lib/geo";

/**
 * PATCH /api/transformers/[id]/correct — fix what an onboarded record got wrong.
 *
 * An onboarded transformer starts life as a set of educated guesses: a rating
 * read through binoculars, a pin dropped on a map, a serial nobody could see.
 * Once an engineer stands under it, those guesses can be replaced with facts.
 *
 * This writes to the AUDIT LOG and never to the event chain. That distinction
 * is the whole design: the chain records what HAPPENED to a transformer, and
 * correcting a typo in its rating is not something that happened to it. Adding
 * data corrections as chain links would leave a custody history where "changed
 * rating from 200 to 315" sits between a dispatch and an installation, and the
 * one document a manager takes to a warranty dispute would be full of clerical
 * noise.
 *
 * Field engineers are allowed here on purpose. They are the only people who
 * ever see the physical plate.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN", "FIELD_ENGINEER");
    const { id } = await context.params;
    const input = correctTransformerSchema.parse(await request.json().catch(() => null));

    const before = await prisma.transformer.findUnique({
      where: { id },
      include: { manufacturer: { select: { id: true, name: true } } },
    });
    if (!before) return NextResponse.json({ error: "Transformer not found." }, { status: 404 });

    // A serial number is the one field that must stay globally unique — it is
    // what stops the same physical unit being registered twice.
    if (input.serialNumber && input.serialNumber !== before.serialNumber) {
      const clash = await prisma.transformer.findUnique({
        where: { serialNumber: input.serialNumber },
        select: { id: true, gNumber: true },
      });
      if (clash && clash.id !== id) {
        return NextResponse.json(
          {
            error: `That serial number already belongs to ${clash.gNumber ?? "another transformer"}.`,
            fields: { serialNumber: "Already registered." },
          },
          { status: 409 },
        );
      }
    }

    let manufacturerName = before.manufacturer.name;
    if (input.manufacturerId && input.manufacturerId !== before.manufacturerId) {
      const m = await prisma.manufacturer.findUnique({ where: { id: input.manufacturerId } });
      if (!m) return NextResponse.json({ error: "That manufacturer no longer exists." }, { status: 422 });
      manufacturerName = m.name;
    }

    const lines: string[] = [];
    const data: Record<string, unknown> = {};

    if (input.serialNumber && input.serialNumber !== before.serialNumber) {
      // A placeholder being replaced is a completion, not a correction.
      const wasPlaceholder = before.serialNumber.startsWith("UNKNOWN-");
      lines.push(
        wasPlaceholder
          ? `Serial number recorded as ${input.serialNumber} (was not readable at onboarding).`
          : `Serial number corrected from ${before.serialNumber} to ${input.serialNumber}.`,
      );
      data.serialNumber = input.serialNumber;
    }
    if (input.manufacturerId && input.manufacturerId !== before.manufacturerId) {
      lines.push(`Manufacturer corrected from ${before.manufacturer.name} to ${manufacturerName}.`);
      data.manufacturerId = input.manufacturerId;
    }
    if (input.ratingKva && input.ratingKva !== before.ratingKva) {
      lines.push(`Rating corrected from ${before.ratingKva} kVA to ${input.ratingKva} kVA.`);
      data.ratingKva = input.ratingKva;
    }
    if (input.mountingType && input.mountingType !== before.mountingType) {
      lines.push(`Type corrected from ${before.mountingType ?? "unrecorded"} to ${input.mountingType}.`);
      data.mountingType = input.mountingType;
    }
    if (input.locationDescription && input.locationDescription !== before.currentSiteName) {
      lines.push(`Location description changed from "${before.currentSiteName ?? "none"}" to "${input.locationDescription}".`);
      data.currentSiteName = input.locationDescription;
    }

    if (input.lat != null && input.lng != null) {
      const moved =
        before.currentLat == null || before.currentLng == null
          ? null
          : distanceKm({ lat: before.currentLat, lng: before.currentLng }, { lat: input.lat, lng: input.lng });

      // Only record a GPS change worth recording. Re-saving a form without
      // touching the map would otherwise log a "correction" of half a metre.
      if (moved == null || moved > 0.005) {
        lines.push(
          `GPS corrected from ${before.currentLat?.toFixed(6) ?? "none"}, ${before.currentLng?.toFixed(6) ?? "none"} ` +
          `to ${input.lat.toFixed(6)}, ${input.lng.toFixed(6)}` +
          (moved != null ? ` (moved ${moved < 1 ? `${Math.round(moved * 1000)} m` : `${moved.toFixed(1)} km`})` : "") +
          ` based on physical inspection.`,
        );
        data.currentLat = input.lat;
        data.currentLng = input.lng;
      }
    }

    if (lines.length === 0) {
      return NextResponse.json({ ok: true, changed: 0, message: "Nothing was different." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.transformer.update({ where: { id }, data });
      await writeAudit(
        {
          actorId: actor.id,
          action: "EDIT",
          targetType: "Transformer",
          targetId: id,
          targetLabel: before.gNumber ?? before.serialNumber,
          details: lines.join(" "),
          reason: input.reason,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, changed: lines.length, details: lines });
  } catch (error) {
    return apiError(error);
  }
}
