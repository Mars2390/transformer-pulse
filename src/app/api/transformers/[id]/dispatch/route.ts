import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { dispatchSchema } from "@/lib/validation";

/**
 * POST /api/transformers/[id]/dispatch — release a transformer to the field.
 *
 * The engine refuses this if the unit has not passed its intake test. That rule
 * lives in recordEvent(), not here, so it holds no matter which screen or
 * script asks.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const { id } = await context.params;

    const body = await request.json().catch(() => null);
    const input = dispatchSchema.parse(body);

    const notes = [
      `Loaded for ${input.destination}.`,
      input.expectedArrival
        ? `Expected ${new Date(input.expectedArrival).toLocaleDateString("en-KE")}.`
        : null,
      input.notes || null,
    ]
      .filter(Boolean)
      .join(" ");

    const result = await recordEvent(
      id,
      {
        type: "DISPATCHED",
        destination: input.destination,
        vehiclePlate: input.vehiclePlate,
        driverName: input.driverName,
        driverPhone: input.driverPhone || null,
        locationName: input.destination,
        region: input.region,
        county: input.county || null,
        photoUrls: input.photoUrls ?? [],
        notes,
      },
      actor,
    );

    return NextResponse.json({ ok: true, status: result.toStatus });
  } catch (error) {
    return apiError(error);
  }
}
