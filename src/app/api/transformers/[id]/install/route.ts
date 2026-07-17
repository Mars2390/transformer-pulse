import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { installSchema } from "@/lib/field-validation";

/** POST /api/transformers/[id]/install — energise at site. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const { id } = await context.params;
    const input = installSchema.parse(await request.json().catch(() => null));

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
        notes: input.notes || `Installed and energised at ${input.siteName}.`,
        test: { ...input.test, stage: "SITE_COMMISSIONING" },
      },
      actor,
    );

    return NextResponse.json({ ok: true, alerts: result.alerts });
  } catch (error) {
    return apiError(error);
  }
}
