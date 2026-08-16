import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { transactionLegSchema } from "@/lib/validation";
import { MOVEMENTS, type MovementKey } from "@/lib/transactions";

/**
 * POST /api/transactions/[id]/leg — the lorry left, or the lorry arrived.
 *
 * These two are deliberately NOT approvals. The people who can honestly say a
 * vehicle departed and arrived are the two standing next to it, and requiring a
 * manager in the middle would mean both timestamps get typed in from memory
 * hours later — which is worse than not recording them at all.
 *
 * ARRIVAL is where the chain is finally written. Everything before it is a
 * request or a journey; only arrival is a fact about the asset. recordEvent
 * re-checks the transition against LIFECYCLE_RULES, so a movement approved days
 * ago against a status that has since changed is still refused here.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiUser();
    const { id } = await ctx.params;

    const body = await request.json().catch(() => null);
    const input = transactionLegSchema.parse(body);

    const record = await prisma.transactionRecord.findUnique({
      where: { id },
      include: { transformer: { select: { id: true, gNumber: true, serialNumber: true, status: true } } },
    });
    if (!record) return NextResponse.json({ error: "Movement not found." }, { status: 404 });

    const movement = MOVEMENTS[record.movement as MovementKey];
    if (!movement) return NextResponse.json({ error: "Unknown movement type." }, { status: 422 });

    const label = record.transformer.gNumber ?? record.transformer.serialNumber;

    // --- Departure -----------------------------------------------------------
    if (input.leg === "DEPART") {
      if (record.status !== "APPROVED") {
        return NextResponse.json(
          {
            error:
              record.status === "PENDING_APPROVAL"
                ? "This movement has not been approved yet. It cannot leave."
                : `This movement is ${record.status.toLowerCase().replace(/_/g, " ")} — it cannot depart.`,
          },
          { status: 409 },
        );
      }

      await prisma.transactionRecord.update({
        where: { id },
        data: { status: "IN_TRANSIT", departedAt: new Date() },
      });

      await writeAudit({
        actorId: actor.id,
        action: "EDIT",
        targetType: "Transformer",
        targetId: record.transformer.id,
        targetLabel: label,
        details: `${actor.name} confirmed departure of ${label} from ${record.fromName} towards ${record.toName}${
          record.vehiclePlate ? ` on ${record.vehiclePlate}` : ""
        }.`,
      });

      return NextResponse.json({ status: "IN_TRANSIT", message: `${label} has left ${record.fromName}.` });
    }

    // --- Arrival -------------------------------------------------------------
    if (record.status !== "IN_TRANSIT") {
      return NextResponse.json(
        {
          error:
            record.status === "APPROVED"
              ? "Confirm departure first. A unit cannot arrive somewhere it never left."
              : `This movement is ${record.status.toLowerCase().replace(/_/g, " ")} — it cannot be received.`,
        },
        { status: 409 },
      );
    }

    // The chain entry. recordEvent enforces the transition and the evidence the
    // rule demands — GPS and a photograph for anything landing on a pole.
    const result = await recordEvent(
      record.transformerId,
      {
        type: movement.completionEvent,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        locationName: record.toName,
        vehiclePlate: record.vehiclePlate,
        driverName: record.driverName,
        driverPhone: record.driverPhone,
        destination: record.toName,
        photoUrls: input.photoUrls ?? [],
        storeId: record.toType === "STORE" || record.toType === "WORKSHOP" ? record.toId : null,
        siteName: record.toType === "SITE" ? record.toName : null,
        notes: [
          `${movement.label}: ${record.fromName} → ${record.toName}.`,
          record.vehiclePlate ? `Vehicle ${record.vehiclePlate}${record.driverName ? `, driver ${record.driverName}` : ""}.` : null,
          `Received by ${actor.name}.`,
          input.notes || null,
        ]
          .filter(Boolean)
          .join(" "),
      },
      actor,
    );

    // Close the loop on the paperwork: the approval that authorised this
    // movement now points at the chain entry it produced. Until this moment
    // the certificate honestly said "not yet acted on"; from here it resolves
    // to a hash, which is what makes a printed sheet checkable.
    //
    // Scoped by transactionId rather than by (transformer, action), because a
    // unit can have several movements of the same kind in its life and only
    // this one just arrived.
    await prisma.approvalDocument.updateMany({
      where: { transactionId: id, status: "APPROVED", eventId: null },
      data: { eventId: result.eventId, chainHash: result.hash },
    });

    await prisma.transactionRecord.update({
      where: { id },
      data: {
        status: "COMPLETED",
        arrivedAt: new Date(),
        receivedById: actor.id,
        receivedAt: new Date(),
        completionEventId: result.eventId,
      },
    });

    await writeAudit({
      actorId: actor.id,
      action: "EDIT",
      targetType: "Transformer",
      targetId: record.transformer.id,
      targetLabel: label,
      details: `${actor.name} received ${label} at ${record.toName}. Movement ${movement.label} complete; chain event ${result.eventId}.`,
    });

    return NextResponse.json({
      status: "COMPLETED",
      eventId: result.eventId,
      toStatus: result.toStatus,
      alerts: result.alerts,
      message: `${label} received at ${record.toName}.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
