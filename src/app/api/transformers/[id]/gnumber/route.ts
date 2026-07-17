import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { assignGNumberSchema } from "@/lib/validation";

/**
 * PATCH /api/transformers/[id]/gnumber — assign a G-Number after intake.
 *
 * This is the one field a store keeper may set after the fact, because a unit
 * genuinely can arrive before its number is issued. It can be SET but never
 * CHANGED: a G-Number that moves between assets makes every historical record
 * that mentions it ambiguous.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiRole("STORE_KEEPER", "ADMIN");
    const { id } = await context.params;

    const body = await request.json().catch(() => null);
    const { gNumber } = assignGNumberSchema.parse(body);

    const existing = await prisma.transformer.findUnique({
      where: { id },
      select: { gNumber: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Transformer not found." }, { status: 404 });
    }
    if (existing.gNumber) {
      return NextResponse.json(
        {
          error: `This transformer already has G-Number ${existing.gNumber}. A G-Number cannot be changed once assigned.`,
        },
        { status: 409 },
      );
    }

    const transformer = await prisma.transformer.update({
      where: { id },
      data: { gNumber },
      select: { id: true, gNumber: true },
    });

    return NextResponse.json({ transformer });
  } catch (error) {
    return apiError(error);
  }
}
