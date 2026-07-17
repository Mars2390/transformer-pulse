import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { faultSchema } from "@/lib/field-validation";

/**
 * POST /api/transformers/[id]/fault — report a fault.
 *
 * The engineer supplies the evidence; the engine does the rest inside
 * recordEvent: status → FAULTY, warranty checked as at the fault date, a claim
 * auto-opened if covered, and a CRITICAL alert raised to the manager.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const { id } = await context.params;
    const input = faultSchema.parse(await request.json().catch(() => null));

    const result = await recordEvent(
      id,
      {
        type: "FAULT_REPORTED",
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        photoUrls: input.photoUrls,
        notes: `${input.cause}: ${input.description}`,
        test: input.test ? { ...input.test, stage: "POST_FAULT" } : null,
      },
      actor,
    );

    return NextResponse.json({ ok: true, alerts: result.alerts });
  } catch (error) {
    return apiError(error);
  }
}
