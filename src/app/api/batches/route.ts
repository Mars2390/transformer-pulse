import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { computeEventHash, CURRENT_HASH_VERSION } from "@/lib/chain";
import { receiveBatchSchema } from "@/lib/validation";

/**
 * POST /api/batches — book in a whole delivery.
 *
 * Every transformer is created exactly as the single-unit receive form creates
 * one: PENDING_APPROVAL, submittedBy set, a RECEIVED_AT_STORE genesis event
 * with prevHash null. The batch is a wrapper, not a second way of existing —
 * so a unit received in a batch and a unit received alone are the same kind of
 * record afterwards, and every downstream screen already understands it.
 *
 * The one thing the batch adds is sampleTested, and it is only meaningful
 * because batchId is set alongside it.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const input = receiveBatchSchema.parse(await request.json().catch(() => null));

    if (!actor.storeId) {
      return NextResponse.json(
        { error: "You are not assigned to a store, so there is nowhere to receive this into." },
        { status: 422 },
      );
    }
    const store = await prisma.store.findUnique({ where: { id: actor.storeId } });
    if (!store || !store.active) {
      return NextResponse.json({ error: "Your store is disabled and cannot receive." }, { status: 422 });
    }

    const manufacturer = await prisma.manufacturer.findUnique({ where: { id: input.manufacturerId } });
    if (!manufacturer) {
      return NextResponse.json({ error: "That manufacturer no longer exists." }, { status: 422 });
    }

    const year = new Date().getFullYear();
    const countThisYear = await prisma.transformerBatch.count({
      where: { batchRef: { startsWith: `B-${year}-` } },
    });
    const batchRef = `B-${year}-${String(countThisYear + 1).padStart(4, "0")}`;

    const receivedAt = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.transformerBatch.create({
        data: {
          batchRef,
          manufacturerId: manufacturer.id,
          totalCount: input.totalCount,
          receivedById: actor.id,
          storeId: store.id,
          status: "PENDING_APPROVAL",
          notes: input.notes || null,
        },
      });

      // G-Numbers are allocated in one run so a batch of forty does not make
      // forty round trips for the next number.
      const latest = await tx.transformer.findFirst({
        where: { gNumber: { startsWith: `G-${year}-` } },
        orderBy: { gNumber: "desc" },
        select: { gNumber: true },
      });
      let next = latest?.gNumber ? Number(latest.gNumber.split("-")[2] ?? 0) : 0;

      const created: { id: string; gNumber: string; sampleTested: boolean }[] = [];

      for (const unit of input.units) {
        next += 1;
        const gNumber = `G-${year}-${String(next).padStart(5, "0")}`;
        const serialNumber = unit.serialNumber || `UNKNOWN-${gNumber}`;

        const t = await tx.transformer.create({
          data: {
            serialNumber,
            gNumber,
            manufacturerId: manufacturer.id,
            ratingKva: unit.ratingKva,
            yearOfManufacture: unit.yearOfManufacture,
            warrantyMonths: manufacturer.warrantyMonths,
            warrantyStart: receivedAt,
            status: "PENDING_APPROVAL",
            submittedById: actor.id,
            submittedAt: receivedAt,
            currentStoreId: store.id,
            region: store.region,
            county: store.county,
            batchId: batch.id,
            sampleTested: unit.sampleTested,
          },
        });

        const notes = [
          `Received from ${manufacturer.name} in batch ${batchRef}.`,
          unit.sampleTested
            ? "Selected for testing under KPLC sampling policy."
            : "Not selected for testing — to be released on the sample under KPLC sampling policy.",
          `Booked in by ${actor.name}. Awaiting approval before it becomes stock.`,
        ].join(" ");

        const hash = computeEventHash(null, {
          transformerId: t.id,
          type: "RECEIVED_AT_STORE",
          fromStatus: null,
          toStatus: "PENDING_APPROVAL",
          userId: actor.id,
          occurredAt: receivedAt,
          lat: store.lat,
          lng: store.lng,
          notes,
        });

        await tx.lifecycleEvent.create({
          data: {
            transformerId: t.id,
            type: "RECEIVED_AT_STORE",
            fromStatus: null,
            toStatus: "PENDING_APPROVAL",
            userId: actor.id,
            occurredAt: receivedAt,
            lat: store.lat,
            lng: store.lng,
            locationName: store.name,
            notes,
            prevHash: null,
            hash,
            hashVersion: CURRENT_HASH_VERSION,
          },
        });

        await tx.transformer.update({ where: { id: t.id }, data: { lastEventHash: hash } });
        created.push({ id: t.id, gNumber, sampleTested: unit.sampleTested });
      }

      await writeAudit(
        {
          actorId: actor.id,
          action: "CREATE",
          targetType: "Transformer",
          targetId: batch.id,
          targetLabel: batchRef,
          details: `${actor.name} booked in ${created.length} ${manufacturer.name} transformers as ${batchRef} at ${store.name}. Delivery note claimed ${input.totalCount}. ${created.filter((c) => c.sampleTested).length} selected for testing.`,
        },
        tx,
      );

      return { batch, created };
    });

    const tested = result.created.filter((c) => c.sampleTested).length;
    const declaredMismatch = input.totalCount !== result.created.length;

    return NextResponse.json(
      {
        batchRef,
        batchId: result.batch.id,
        entered: result.created.length,
        declared: input.totalCount,
        tested,
        untested: result.created.length - tested,
        declaredMismatch,
        message: `${batchRef}: ${result.created.length} entered, ${tested} for testing, ${result.created.length - tested} to be released on the sample.${declaredMismatch ? ` Delivery note said ${input.totalCount} — the difference is on the record.` : ""}`,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
