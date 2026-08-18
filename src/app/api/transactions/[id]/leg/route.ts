import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { transactionLegSchema } from "@/lib/validation";
import { MOVEMENTS, carriesTransformer, requiresSiteEngineer, type MovementKey } from "@/lib/transactions";

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
      include: {
        transformer: { select: { id: true, gNumber: true, serialNumber: true, status: true, region: true } },
        presentEngineer: { select: { name: true } },
      },
    });
    if (!record) return NextResponse.json({ error: "Movement not found." }, { status: 404 });

    const movement = MOVEMENTS[record.movement as MovementKey];
    if (!movement) return NextResponse.json({ error: "Unknown movement type." }, { status: 422 });

    const label = record.transformer.gNumber ?? record.transformer.serialNumber;

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

      // An approval says the movement MAY happen. It does not say anybody was
      // there when it did. For a movement out of a site those are different
      // claims, and only the engineer standing at the pole can make the second.
      if (requiresSiteEngineer(movement) && !record.presenceConfirmedAt) {
        return NextResponse.json(
          {
            error: record.presentEngineerId
              ? `${record.presentEngineer?.name ?? "The named engineer"} has not confirmed they are at ${record.fromName}. The lorry cannot leave a site nobody is attending.`
              : "No field engineer is named on this movement, so nothing can leave the site.",
            needsPresence: true,
          },
          { status: 409 },
        );
      }

      // Plate and driver were required when this was raised, but that was the
      // PLANNED lorry and days may have passed. Anything supplied now replaces
      // it, so the register ends up holding the vehicle that went rather than
      // the one somebody expected.
      const plate = input.vehiclePlate || record.vehiclePlate;
      const driver = input.driverName || record.driverName;
      const phone = input.driverPhone || record.driverPhone;

      if (carriesTransformer(movement)) {
        const missing = {
          vehiclePlate: plate ? undefined : "Required.",
          driverName: driver ? undefined : "Required.",
          driverPhone: phone ? undefined : "Required — somebody has to be able to ring the lorry.",
        };
        if (Object.values(missing).some(Boolean)) {
          return NextResponse.json(
            {
              error:
                "Nothing leaves without a vehicle, a driver, and a number that reaches them. This movement predates that rule — fill them in here.",
              fields: missing,
            },
            { status: 422 },
          );
        }
      }

      await prisma.transactionRecord.update({
        where: { id },
        data: {
          status: "IN_TRANSIT",
          departedAt: new Date(),
          vehiclePlate: plate,
          driverName: driver,
          driverPhone: phone,
        },
      });

      await writeAudit({
        actorId: actor.id,
        action: "EDIT",
        targetType: "Transformer",
        targetId: record.transformer.id,
        targetLabel: label,
        details: `${actor.name} confirmed departure of ${label} from ${record.fromName} towards ${record.toName}${
          plate ? ` on ${plate}` : ""
        }${driver ? `, driver ${driver}${phone ? ` (${phone})` : ""}` : ""}.`,
      });

      return NextResponse.json({ status: "IN_TRANSIT", message: `${label} has left ${record.fromName}.` });
    }

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

    // Arrival is the moment custody changes hands, and it is the one moment in
    // a movement a manager genuinely wants pushed at them: they authorised a
    // transformer to travel and now it is somewhere else. Departure gets no
    // alert on purpose — a lorry leaving is a plan, and an alert per leg is how
    // a bell becomes noise somebody stops reading.
    //
    // A STORED row, unlike the pending-approval counts, because this is a fact
    // that happened at a time rather than a count of outstanding work. It stays
    // until a manager acknowledges it.
    //
    // Region is read from the transformer AFTER recordEvent, not before: the
    // movement may have just changed it, and an alert filed under where the
    // unit used to be would land in the wrong manager's list.
    const landed = await prisma.transformer.findUnique({
      where: { id: record.transformer.id },
      select: { region: true, status: true },
    });

    await prisma.alert.create({
      data: {
        transformerId: record.transformer.id,
        type: "MOVEMENT_ARRIVED",
        severity: "INFO",
        region: landed?.region ?? record.transformer.region ?? null,
        message: `${label} arrived at ${record.toName}. ${movement.label} complete — the unit is now ${(landed?.status ?? result.toStatus).replace(/_/g, " ").toLowerCase()}. Received by ${actor.name}.`,
      },
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
