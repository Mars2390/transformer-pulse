import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/events";
import { installSchema } from "@/lib/field-validation";
import { consumeApproval, isAuthorised, openApproval } from "@/lib/approval-store";

/**
 * POST /api/transformers/[id]/install — energise at site.
 *
 * THE APPROVAL GATE, AND WHY IT HAS A DOOR IN IT
 * ---------------------------------------------
 * Installation now requires a signed INSTALL approval. That is the rule KPLC
 * asked for, and it is enforced here rather than in the form, because the form
 * is not the only way to reach this endpoint.
 *
 * Enforced with no exception it would also be dangerous. Picture the case it
 * has to survive: a crew at a pole at half past four, a replacement on the
 * lorry, four hundred customers off supply, and a regional manager who is in a
 * meeting. A gate with no door means the outage lasts exactly as long as it
 * takes somebody to answer a phone — and the manager being waited on has
 * strictly less information than the engineer standing at the pole.
 *
 * So there is a door, and it is narrow:
 *
 *   - the engineer types a reason of at least fifteen characters, because
 *     "emergency" tells a reviewing manager nothing
 *   - the system raises the approval document ITSELF, marked EMERGENCY, and
 *     leaves it PENDING — the work is done, the authority is not granted, and
 *     the queue says so
 *   - the certificate carries EMERGENCY AUTHORISATION in a box on its face
 *   - the chain entry records the reason in the event notes, where it cannot
 *     be edited afterwards
 *
 * The paperwork is identical. What differs is the order: supply comes back
 * first and the signature catches up. An escape hatch that is visible
 * afterwards is a control; a silent one is a hole.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const { id } = await context.params;
    const input = installSchema.parse(await request.json().catch(() => null));

    const authorised = await isAuthorised(id, "INSTALL");
    const emergency = Boolean(input.emergency) && !authorised;

    if (!authorised && !emergency) {
      return NextResponse.json(
        {
          error:
            "Installation has not been approved for this unit yet. Request approval from your " +
            "dashboard — or, if supply is off and customers are waiting, use the emergency path " +
            "and say why.",
          needsApproval: "INSTALL",
        },
        { status: 409 },
      );
    }

    const result = await recordEvent(
      id,
      {
        type: "INSTALLED",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        siteName: input.siteName,
        locationName: input.siteName,
        feeder: input.feeder || null,
        sdb: input.sdb || null,
        region: actor.region ?? null,
        photoUrls: input.photoUrls,
        notes: [
          input.notes || `Installed and energised at ${input.siteName}.`,
          emergency
            ? `EMERGENCY INSTALL, carried out before approval. Reason given: ${input.emergencyReason}`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        test: { ...input.test, stage: "SITE_COMMISSIONING" },
      },
      actor,
    );

    let ratification: string | null = null;

    if (emergency) {
      const doc = await openApproval(
        {
          action: "INSTALL",
          transformerId: id,
          justification: input.emergencyReason || null,
          contextLabel: input.siteName,
          emergency: true,
        },
        actor,
      );
      // Point it at the chain entry immediately. The work already happened, so
      // "not yet acted on" would be a lie on the face of the document.
      await prisma.approvalDocument.update({
        where: { id: doc.id },
        data: { eventId: result.eventId, chainHash: result.hash },
      });
      ratification = doc.reference;
    } else {
      await consumeApproval(id, "INSTALL", { eventId: result.eventId, hash: result.hash });
    }

    return NextResponse.json({
      ok: true,
      alerts: result.alerts,
      emergency,
      ratification,
      message: emergency
        ? `Installed. ${ratification} has been raised for a manager to ratify — supply first, signature after.`
        : "Installed and energised.",
    });
  } catch (error) {
    return apiError(error);
  }
}
