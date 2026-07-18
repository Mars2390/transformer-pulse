import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit, describeChanges } from "@/lib/audit";
import { manufacturerSchema } from "@/lib/admin-validation";

/**
 * PATCH /api/admin/manufacturers/[id] — edit a manufacturer.
 *
 * A warranty-months change affects only FUTURE transformers. Each transformer
 * copied its warranty at intake, so units already in the field keep the terms
 * they were received under. This is enforced by the data model, not by a note.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("ADMIN");
    const { id } = await context.params;
    const input = manufacturerSchema.parse(await request.json().catch(() => null));

    const before = await prisma.manufacturer.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Manufacturer not found." }, { status: 404 });

    const after = {
      name: input.name,
      country: input.country || null,
      warrantyMonths: input.warrantyMonths,
      contactName: input.contactName || null,
      contactEmail: input.contactEmail || null,
      contactPhone: input.contactPhone || null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.manufacturer.update({ where: { id }, data: after });
      const details = describeChanges(
        before as unknown as Record<string, unknown>,
        after,
        { name: "name", warrantyMonths: "warranty months", contactEmail: "email" },
      );
      await writeAudit(
        {
          actorId: actor.id,
          action: "EDIT",
          targetType: "Manufacturer",
          targetId: id,
          targetLabel: input.name,
          details: details || "No values changed",
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
