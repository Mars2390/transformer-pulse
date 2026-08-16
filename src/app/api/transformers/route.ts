import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { computeEventHash } from "@/lib/chain";
import { receiveTransformerSchema } from "@/lib/validation";

/**
 * POST /api/transformers — receive a transformer from a manufacturer.
 *
 * This is where a transformer's story begins. It creates the asset AND its
 * genesis event in one transaction: a transformer without a first event would
 * have no chain to hang the rest of its life on.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");

    const body = await request.json().catch(() => null);
    const input = receiveTransformerSchema.parse(body);

    const manufacturer = await prisma.manufacturer.findUnique({
      where: { id: input.manufacturerId },
    });
    if (!manufacturer) {
      return NextResponse.json(
        { error: "That manufacturer no longer exists." },
        { status: 422 },
      );
    }

    const store = actor.storeId
      ? await prisma.store.findUnique({ where: { id: actor.storeId } })
      : null;
    if (!store) {
      return NextResponse.json(
        {
          error:
            "Your account is not assigned to a store, so there is nowhere to receive this into. Ask an administrator to assign you one.",
        },
        { status: 422 },
      );
    }

    const receivedAt = new Date();

    const transformer = await prisma.$transaction(async (tx) => {
      const created = await tx.transformer.create({
        data: {
          serialNumber: input.serialNumber,
          gNumber: input.gNumber || null,
          manufacturerId: manufacturer.id,
          ratingKva: input.ratingKva,
          primaryKv: input.primaryKv,
          secondaryKv: input.secondaryKv,
          phases: input.phases,
          coolingType: input.coolingType,
          impedancePct: input.impedancePct ?? null,
          vectorGroup: input.vectorGroup || null,
          oilVolumeLitres: input.oilVolumeLitres ?? null,
          yearOfManufacture: input.yearOfManufacture,

          // Full nameplate — empty strings normalised to null.
          frequencyHz: input.frequencyHz ?? null,
          duty: input.duty || null,
          standardRef: input.standardRef || null,
          hvInsulationLevelKv: input.hvInsulationLevelKv || null,
          tempRiseOilC: input.tempRiseOilC ?? null,
          tempRiseWindingC: input.tempRiseWindingC ?? null,
          tempClass: input.tempClass || null,
          maxAmbientTempC: input.maxAmbientTempC ?? null,
          insulationOilType: input.insulationOilType || null,
          oilWeightKg: input.oilWeightKg ?? null,
          totalWeightKg: input.totalWeightKg ?? null,
          tapRange: input.tapRange || null,

          // Copied from the manufacturer, not referenced. Renegotiating a
          // contract next year must not silently rewrite the warranty of units
          // already sitting in the field.
          warrantyMonths: manufacturer.warrantyMonths,
          // The clock starts the day KPLC takes delivery. Never at manufacture.
          warrantyStart: receivedAt,

          fatReportUrl: input.fatReportUrl || null,
          fatReportUploadedAt: input.fatReportUrl ? receivedAt : null,
          fatReportUploadedById: input.fatReportUrl ? actor.id : null,

          // MAKER step. A receiving officer books the unit in; it is NOT stock
          // yet. TESTED and DISPATCHED both list only IN_STORE in allowedFrom,
          // so the lifecycle engine refuses them while it sits here — the gate
          // is the status itself, not a check somebody could forget to write.
          status: "PENDING_APPROVAL",
          submittedById: actor.id,
          submittedAt: receivedAt,
          currentStoreId: store.id,
          region: store.region,
          county: store.county,
        },
      });

      // The genesis link: prevHash is null, and only ever here.
      const notes = [
        `Received from ${manufacturer.name}.`,
        input.deliveryNoteRef ? `Delivery note ${input.deliveryNoteRef}.` : null,
        `Warranty runs ${manufacturer.warrantyMonths} months from today.`,
        `Booked in by ${actor.name}. Awaiting a checker's approval before it becomes stock.`,
      ]
        .filter(Boolean)
        .join(" ");

      const hash = computeEventHash(null, {
        transformerId: created.id,
        type: "RECEIVED_AT_STORE",
        toStatus: "PENDING_APPROVAL",
        userId: actor.id,
        occurredAt: receivedAt,
        lat: store.lat,
        lng: store.lng,
        vehiclePlate: input.vehiclePlate || null,
        driverName: input.driverName || null,
        notes,
      });

      await tx.lifecycleEvent.create({
        data: {
          transformerId: created.id,
          type: "RECEIVED_AT_STORE",
          fromStatus: null, // it did not exist before this moment
          toStatus: "PENDING_APPROVAL",
          userId: actor.id,
          occurredAt: receivedAt,
          lat: store.lat,
          lng: store.lng,
          locationName: store.name,
          vehiclePlate: input.vehiclePlate || null,
          driverName: input.driverName || null,
          photoUrls: input.photoUrls ?? [],
          notes,
          prevHash: null,
          hash,
        },
      });

      return tx.transformer.update({
        where: { id: created.id },
        data: { lastEventHash: hash },
        select: { id: true, serialNumber: true, gNumber: true },
      });
    });

    return NextResponse.json({ transformer }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
