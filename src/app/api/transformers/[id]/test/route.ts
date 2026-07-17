import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { intakeTestSchema } from "@/lib/validation";

/**
 * POST /api/transformers/[id]/test — record a test.
 *
 * The visual checklist is appended to the remarks rather than stored in its own
 * columns: it is qualitative, it changes whenever KPLC revises the checklist,
 * and no query we run would ever filter on "silica gel was pink".
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const { id } = await context.params;

    const body = await request.json().catch(() => null);
    const { values, visual } = intakeTestSchema.parse(body);

    const checklist = [
      `Tank: ${visual.tankCondition.toLowerCase()}`,
      `Bushings: ${visual.bushings.toLowerCase()}`,
      `Silica gel: ${visual.silicaGel.toLowerCase()}`,
      `Oil level: ${visual.oilLevel.toLowerCase()}`,
      `Nameplate legible: ${visual.nameplateLegible.toLowerCase()}`,
    ].join(" · ");

    const remarks = [values.remarks?.trim(), `Visual — ${checklist}`]
      .filter(Boolean)
      .join("\n");

    const result = await recordEvent(
      id,
      {
        type: "TESTED",
        notes: values.passed
          ? "Intake test passed. Cleared for dispatch."
          : "Intake test FAILED. Withheld from dispatch.",
        test: { ...values, remarks },
      },
      actor,
    );

    return NextResponse.json({
      ok: true,
      passed: values.passed,
      alerts: result.alerts,
    });
  } catch (error) {
    return apiError(error);
  }
}
