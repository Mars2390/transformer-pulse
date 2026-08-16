import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recordEvent } from "@/lib/events";
import { dispatchSchema } from "@/lib/validation";
import { sameRegion } from "@/lib/region-scope";

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

    // --- Who is receiving it -------------------------------------------------
    // Checked here, not only in the form. An engineer must exist, be active,
    // and be a field engineer; and their region must match where the unit is
    // going, because an assignment to somebody 300 km away is the same as no
    // assignment with extra paperwork.
    const engineer = await prisma.user.findUnique({
      where: { id: input.assignedEngineerId },
      select: { id: true, name: true, role: true, active: true, region: true },
    });
    if (!engineer || engineer.role !== "FIELD_ENGINEER") {
      return NextResponse.json(
        { error: "Choose a field engineer.", fields: { assignedEngineerId: "Not a field engineer." } },
        { status: 422 },
      );
    }
    if (!engineer.active) {
      return NextResponse.json(
        { error: `${engineer.name}'s account is disabled.`, fields: { assignedEngineerId: "Account disabled." } },
        { status: 422 },
      );
    }
    if (!sameRegion(engineer.region, input.region)) {
      return NextResponse.json(
        {
          error: `${engineer.name} works in ${engineer.region ?? "no recorded region"}, but this is going to ${input.region}.`,
          fields: { assignedEngineerId: "Wrong region." },
        },
        { status: 422 },
      );
    }

    const notes = [
      `Loaded for ${input.destination}.`,
      `Assigned to ${engineer.name}.`,
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

    // The assignment is on the transformer, not only in the event text, so the
    // engineer's dashboard is one indexed query rather than a scan of notes.
    await prisma.transformer.update({
      where: { id },
      data: { assignedEngineerId: engineer.id, assignedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      status: result.toStatus,
      assignedTo: engineer.name,
      message: `Dispatched. ${engineer.name} will see it on their phone.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
