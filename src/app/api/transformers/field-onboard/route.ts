import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { computeEventHash } from "@/lib/chain";
import { fieldOnboardSchema } from "@/lib/validation";
import { writeAudit } from "@/lib/audit";
import { lookupSubstation, formatSubstation } from "@/lib/substations";

/**
 * POST /api/transformers/field-onboard — a field engineer records a transformer
 * they are standing under.
 *
 * The store route next door does the same job from a desk: somebody clicks a
 * map where they believe a transformer is. This one is the version that has
 * actual evidence. The engineer is at the asset, the phone has a GPS fix with a
 * stated accuracy, there are photographs, and they know the substation number
 * because it is written on the thing they walked past to get here.
 *
 * Three consequences follow from that, and they are the whole reason this is a
 * separate route rather than a role added to the other one:
 *
 *   1. positionSource is SURVEYED, with the device's accuracy recorded. The
 *      desk flow leaves provenance null, which is how pins ended up invisible
 *      to the map's provenance filter.
 *   2. verifiedAt is set. The store route deliberately does not set it, with
 *      the comment "nobody has stood under it yet". Here somebody has, and
 *      pretending otherwise would understate the one record we can most trust.
 *   3. The substation code is mandatory and links the unit into the network.
 *
 * No approval step. A field engineer does not need permission to write down
 * what exists — but the write is audited by name, GPS and substation, so a
 * manager can see who added what and from where.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");

    const body = await request.json().catch(() => null);
    const input = fieldOnboardSchema.parse(body);

    const manufacturer = await prisma.manufacturer.findUnique({
      where: { id: input.manufacturerId },
    });
    if (!manufacturer) {
      return NextResponse.json(
        { error: "That manufacturer no longer exists.", fields: { manufacturerId: "Choose again." } },
        { status: 422 },
      );
    }

    // --- Substation ---------------------------------------------------------
    // "Exists" means something in the system has referenced this code before —
    // a sibling transformer, an inspection, an EMDis file. If so the unit joins
    // them; if not, this record is the first mention and the code becomes real
    // from here. Either way the engineer is not asked to care which.
    const substation = await lookupSubstation(input.substationCode);
    const substationName = input.substationName || substation.name || null;

    // --- G-Number -----------------------------------------------------------
    // Same allocation as the store route: the field must not invent a different
    // numbering scheme for the same fleet.
    const year = new Date().getFullYear();
    let gNumber = input.gNumber || "";
    if (!gNumber) {
      const latest = await prisma.transformer.findFirst({
        where: { gNumber: { startsWith: `G-${year}-` } },
        orderBy: { gNumber: "desc" },
        select: { gNumber: true },
      });
      const last = latest?.gNumber ? Number(latest.gNumber.split("-")[2] ?? 0) : 0;
      gNumber = `G-${year}-${String(last + 1).padStart(5, "0")}`;
    }

    const taken = await prisma.transformer.findUnique({ where: { gNumber } });
    if (taken) {
      return NextResponse.json(
        { error: `${gNumber} is already in use. Pick another.`, fields: { gNumber: "Already in use." } },
        { status: 409 },
      );
    }

    // A blank serial is normal — it is usually on the far side of the tank or
    // corroded off. The placeholder keeps the unique column honest without
    // inventing a number that could later be mistaken for a real one.
    const serialNumber = input.serialNumber || `UNKNOWN-${gNumber}`;
    if (input.serialNumber) {
      const dupe = await prisma.transformer.findUnique({
        where: { serialNumber },
        select: { id: true, gNumber: true },
      });
      if (dupe) {
        return NextResponse.json(
          {
            error: `Serial ${serialNumber} is already recorded as ${dupe.gNumber ?? "another unit"}.`,
            fields: { serialNumber: "Already recorded." },
            existingTransformerId: dupe.id,
          },
          { status: 409 },
        );
      }
    }

    const occurredAt = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const transformer = await tx.transformer.create({
        data: {
          serialNumber,
          gNumber,
          manufacturerId: manufacturer.id,
          ratingKva: input.ratingKva,
          // An unknown year is recorded as this year only because the column is
          // required. The note below says so in words, so no age-based score is
          // ever read as fact.
          yearOfManufacture: input.yearOfManufacture ?? occurredAt.getFullYear(),
          dataSource: "FIELD_SURVEY",

          status: "IN_FIELD",
          currentLat: input.lat,
          currentLng: input.lng,
          currentSiteName: input.locationDescription,
          region: actor.region || null,

          substationCode: substation.code,
          substationName,

          // The difference that matters: a fix taken at the asset, with the
          // device's own uncertainty alongside it.
          positionSource: "SURVEYED",
          positionAccuracyM: input.accuracyM ?? null,
          positionSourceText: `GPS fix by ${actor.name} during field onboarding.`,
          verifiedAt: occurredAt,

          // No warranty claimed. KPLC's delivery date for a unit found on a
          // pole is unknown, and inventing one manufactures a claim nobody can
          // substantiate.
          warrantyMonths: 0,
          warrantyStart: null,
        },
      });

      const notes = [
        `Existing transformer onboarded in the field by ${actor.name}.`,
        `Substation ${formatSubstation(substation.code, substationName)}${
          substation.existed ? " (already known to the system)" : " (first record of this substation)"
        }.`,
        input.accuracyM != null ? `GPS accurate to ±${input.accuracyM} m.` : null,
        input.yearOfManufacture ? null : "Year of manufacture not established.",
        input.serialNumber ? null : "Serial number not readable from the ground.",
        input.notes || null,
      ]
        .filter(Boolean)
        .join(" ");

      // Genesis: prevHash null. This is the earliest moment KPLC has any record
      // of this asset at all.
      const hash = computeEventHash(null, {
        transformerId: transformer.id,
        type: "ONBOARDED_EXISTING",
        toStatus: "IN_FIELD",
        userId: actor.id,
        occurredAt,
        lat: input.lat,
        lng: input.lng,
        notes,
      });

      await tx.lifecycleEvent.create({
        data: {
          transformerId: transformer.id,
          type: "ONBOARDED_EXISTING",
          fromStatus: null, // it did not exist to us before now
          toStatus: "IN_FIELD",
          userId: actor.id,
          occurredAt,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM ?? null,
          locationName: input.locationDescription,
          photoUrls: input.photoUrls ?? [],
          notes,
          hash,
          prevHash: null,
        },
      });

      await tx.transformer.update({
        where: { id: transformer.id },
        data: { lastEventHash: hash, commissionDate: null },
      });

      // Onboarding needs no approval, but it is not anonymous. This is the row
      // a manager reads when they want to know who added a unit and from where.
      await writeAudit(
        {
          actorId: actor.id,
          action: "CREATE",
          targetType: "Transformer",
          targetId: transformer.id,
          targetLabel: gNumber,
          details: `Field engineer ${actor.name} onboarded ${gNumber} at ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}${
            input.accuracyM != null ? ` (±${input.accuracyM} m)` : ""
          } — substation ${formatSubstation(substation.code, substationName)}.`,
        },
        tx,
      );

      return transformer;
    });

    return NextResponse.json(
      {
        transformer: {
          id: created.id,
          gNumber: created.gNumber,
          serialNumber: created.serialNumber,
          serialKnown: Boolean(input.serialNumber),
        },
        substation: {
          code: substation.code,
          name: substationName,
          linked: substation.existed,
        },
        message: substation.existed
          ? `${gNumber} onboarded and linked to substation ${substation.code}. It is on the map now.`
          : `${gNumber} onboarded. Substation ${substation.code} is now recorded for the first time.`,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
