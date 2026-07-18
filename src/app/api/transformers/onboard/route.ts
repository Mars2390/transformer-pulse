import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { computeEventHash } from "@/lib/chain";
import { onboardTransformerSchema } from "@/lib/validation";
import { DATA_SOURCE_META } from "@/lib/format";

/**
 * POST /api/transformers/onboard — add a transformer that is ALREADY installed.
 *
 * The store-flow route next door starts a transformer's life at the moment it
 * arrives from a manufacturer. This one starts it in the middle: KPLC has tens
 * of thousands of units already energised on poles, and none of them will ever
 * walk back through a store to be booked in properly.
 *
 * So the chain begins where we found it. The genesis event is ONBOARDED_EXISTING
 * with prevHash null, exactly like a store receipt, and everything downstream —
 * inspections, faults, replacement — works unchanged from there.
 *
 * What this route will NOT do is pretend to know more than it does. The record
 * carries its own provenance, and until a field engineer stands under the unit
 * it is labelled as unverified everywhere it appears.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");

    const body = await request.json().catch(() => null);
    const input = onboardTransformerSchema.parse(body);

    const manufacturer = await prisma.manufacturer.findUnique({
      where: { id: input.manufacturerId },
    });
    if (!manufacturer) {
      return NextResponse.json({ error: "That manufacturer no longer exists." }, { status: 422 });
    }

    // --- G-Number -----------------------------------------------------------
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

    // --- Serial number ------------------------------------------------------
    // The column is required and unique, and must stay that way — it is what
    // stops the same physical unit being registered twice. But a keeper at a
    // roadside pole frequently cannot read it: the plate faces away from the
    // road, or has corroded to nothing.
    //
    // So an unread serial gets an explicit placeholder tied to the G-Number
    // rather than a blank or a shared "UNKNOWN" (which would collide on the
    // second unit). It reads as unknown to a human, stays unique to the
    // database, and the field engineer overwrites it with the real one at the
    // first inspection.
    const serialNumber = input.serialNumber || `UNKNOWN-${gNumber}`;

    if (input.serialNumber) {
      const dup = await prisma.transformer.findUnique({
        where: { serialNumber: input.serialNumber },
        select: { gNumber: true },
      });
      if (dup) {
        return NextResponse.json(
          {
            error: `That serial number is already registered as ${dup.gNumber ?? "another unit"}.`,
            fields: { serialNumber: "Already registered." },
          },
          { status: 409 },
        );
      }
    }

    const occurredAt = new Date();
    const sourceLabel = DATA_SOURCE_META[input.dataSource]?.label ?? input.dataSource;

    const transformer = await prisma.$transaction(async (tx) => {
      const created = await tx.transformer.create({
        data: {
          serialNumber,
          gNumber,
          manufacturerId: manufacturer.id,
          ratingKva: input.ratingKva,
          // Year is an estimate from the plate, or genuinely unknown. Falling
          // back to this year would be a lie that quietly poisons every
          // age-based health score, so an unknown year is recorded as the
          // oldest plausible rather than the newest.
          yearOfManufacture: input.yearOfManufacture ?? occurredAt.getFullYear(),
          mountingType: input.mountingType,
          dataSource: input.dataSource,

          // Already energised — that is the entire premise.
          status: "IN_FIELD",
          currentLat: input.lat,
          currentLng: input.lng,
          currentSiteName: input.locationDescription,
          region: input.region || actor.region || null,
          feeder: input.feeder || null,

          // No warranty is claimed. We do not know when KPLC took delivery, and
          // inventing a start date would manufacture a claim against a
          // manufacturer that nobody can substantiate.
          warrantyMonths: 0,
          warrantyStart: null,

          // Not verifiedAt: nobody has stood under it yet.
        },
      });

      const notes = [
        `Existing transformer onboarded via map pin by ${actor.name}.`,
        `Data source: ${sourceLabel}.`,
        input.yearOfManufacture ? null : "Year of manufacture not established.",
        input.serialNumber ? null : "Serial number not readable from the ground.",
        "Requires physical inspection to verify.",
        input.notes || null,
      ]
        .filter(Boolean)
        .join(" ");

      // Genesis: prevHash null. The chain starts here because this is the
      // earliest moment KPLC has any record of this asset at all.
      const hash = computeEventHash(null, {
        transformerId: created.id,
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
          transformerId: created.id,
          type: "ONBOARDED_EXISTING",
          fromStatus: null, // no prior state — it did not exist to us before now
          toStatus: "IN_FIELD",
          userId: actor.id,
          occurredAt,
          lat: input.lat,
          lng: input.lng,
          locationName: input.locationDescription,
          notes,
          hash,
          prevHash: null,
        },
      });

      await tx.transformer.update({
        where: { id: created.id },
        data: { lastEventHash: hash, commissionDate: null },
      });

      return created;
    });

    return NextResponse.json(
      {
        transformer: {
          id: transformer.id,
          gNumber: transformer.gNumber,
          serialNumber: transformer.serialNumber,
          serialKnown: Boolean(input.serialNumber),
        },
        message: `${gNumber} onboarded. Now visible on all dashboards.`,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
