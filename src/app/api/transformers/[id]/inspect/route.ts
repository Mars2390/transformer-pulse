import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { inspectSchema } from "@/lib/field-validation";

/** POST /api/transformers/[id]/inspect — routine field inspection. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const { id } = await context.params;
    const input = inspectSchema.parse(await request.json().catch(() => null));

    const { visual } = input;
    const checklist = [
      `Tank: ${visual.tankCondition.toLowerCase()}`,
      `Bushings: ${visual.bushings.toLowerCase()}`,
      `Silica gel: ${visual.silicaGel.toLowerCase()}`,
      `Oil level: ${visual.oilLevel.toLowerCase()}`,
      `Oil leaks: ${visual.oilLeaks.toLowerCase()}`,
      `Earthing: ${visual.earthing.toLowerCase()}`,
      `Security: ${visual.security.toLowerCase()}`,
      `Vegetation: ${visual.vegetation.toLowerCase()}`,
    ].join(" · ");

    const remarks = [input.test.remarks?.trim(), `Visual — ${checklist}`]
      .filter(Boolean)
      .join("\n");

    const result = await recordEvent(
      id,
      {
        type: "INSPECTED",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        photoUrls: input.photoUrls ?? [],
        notes: input.notes || "Routine inspection.",
        test: { ...input.test, stage: "ROUTINE", remarks },
      },
      actor,
    );

    return NextResponse.json({ ok: true, alerts: result.alerts });
  } catch (error) {
    return apiError(error);
  }
}
