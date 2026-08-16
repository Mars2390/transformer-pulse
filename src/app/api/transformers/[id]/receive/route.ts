import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/events";
import { confirmReceiptSchema } from "@/lib/field-validation";

/** POST /api/transformers/[id]/receive — field engineer confirms arrival. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const { id } = await context.params;
    const input = confirmReceiptSchema.parse(await request.json().catch(() => null));

    const result = await recordEvent(
      id,
      {
        type: "RECEIVED_BY_FIELD",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        photoUrls: input.photoUrls ?? [],
        notes: input.notes || "Received on site. Condition checked against dispatch note.",
      },
      actor,
    );

    // The assignment has done its job the moment the engineer signs for it.
    // Leaving it set would keep the unit in their "awaiting confirmation" list
    // and in the 48-hour overdue count for ever.
    await prisma.transformer.update({
      where: { id },
      data: { assignedEngineerId: null, assignedAt: null },
    });

    return NextResponse.json({ ok: true, alerts: result.alerts });
  } catch (error) {
    return apiError(error);
  }
}
