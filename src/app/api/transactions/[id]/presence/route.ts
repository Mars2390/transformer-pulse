import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { presenceConfirmSchema } from "@/lib/validation";
import { MOVEMENTS, requiresSiteEngineer, type MovementKey } from "@/lib/transactions";

/**
 * POST /api/transactions/[id]/presence — "I am at the pole."
 *
 * ONLY THE NAMED ENGINEER MAY DO THIS, and that is the entire point of the
 * route existing separately from raising the movement.
 *
 * Naming an engineer is something a keeper, a store manager or a regional
 * manager can do from an office. Being at the site is not. If the same person
 * who raised the movement could also confirm the attendance, the field would
 * record an intention rather than a fact, and the register would show a
 * transformer leaving a pole that nobody stood at.
 *
 * So: no admin override. An administrator can do almost anything else in this
 * system, and deliberately cannot do this — an override here would be used, and
 * the moment it is used the field stops meaning what it says. If the named
 * engineer is unreachable, the movement is re-raised naming somebody who is
 * actually there, which is the honest correction.
 *
 * There is no un-confirm, either. Somebody was at the pole at that time; that
 * is a fact and facts do not get retracted. A movement that should not proceed
 * is refused at approval or simply never departs.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiUser();
    const { id } = await context.params;
    const input = presenceConfirmSchema.parse(await request.json().catch(() => ({})));

    const record = await prisma.transactionRecord.findUnique({
      where: { id },
      include: {
        transformer: { select: { id: true, gNumber: true, serialNumber: true } },
        presentEngineer: { select: { id: true, name: true } },
      },
    });
    if (!record) {
      return NextResponse.json({ error: "No such movement." }, { status: 404 });
    }

    const movement = MOVEMENTS[record.movement as MovementKey];
    if (!movement || !requiresSiteEngineer(movement)) {
      return NextResponse.json(
        { error: "That movement does not start at a site, so there is nothing to confirm." },
        { status: 409 },
      );
    }
    if (record.status === "REJECTED") {
      return NextResponse.json(
        { error: "That movement was refused. There is nothing to attend." },
        { status: 409 },
      );
    }
    if (record.status === "COMPLETED" || record.status === "IN_TRANSIT") {
      return NextResponse.json(
        { error: "That movement has already left the site." },
        { status: 409 },
      );
    }
    if (!record.presentEngineerId) {
      return NextResponse.json(
        { error: "No engineer is named on this movement." },
        { status: 409 },
      );
    }
    if (record.presentEngineerId !== actor.id) {
      return NextResponse.json(
        {
          error: `Only ${record.presentEngineer?.name ?? "the named engineer"} can confirm they are at the site.`,
        },
        { status: 403 },
      );
    }
    if (record.presenceConfirmedAt) {
      // Not an error worth failing on — a second tap on a slow connection is
      // the most likely cause, and telling somebody off for it is unhelpful.
      return NextResponse.json({
        ok: true,
        alreadyConfirmed: true,
        message: "Already confirmed.",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.transactionRecord.update({
        where: { id },
        data: {
          presenceConfirmedAt: new Date(),
          presenceConfirmedById: actor.id,
          notes: [
            record.notes,
            `${actor.name} confirmed presence at ${record.fromName}.`,
            input.lat != null && input.lng != null
              ? `Confirmed at ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}${input.accuracyM != null ? ` (±${input.accuracyM} m)` : ""}.`
              : "No GPS fix was available at the time of confirmation.",
            input.notes || null,
          ]
            .filter(Boolean)
            .join(" "),
        },
      });

      await writeAudit(
        {
          actorId: actor.id,
          action: "EDIT",
          targetType: "Transformer",
          targetId: record.transformer.id,
          targetLabel: record.transformer.gNumber ?? record.transformer.serialNumber,
          details: `${actor.name} confirmed they are present at ${record.fromName} for the ${movement.label} movement${record.batchRef ? ` (${record.batchRef})` : ""}.`,
        },
        tx,
      );
    });

    return NextResponse.json({
      ok: true,
      message: `Presence confirmed at ${record.fromName}. The movement can now depart once it is approved.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
