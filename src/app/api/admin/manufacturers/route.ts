import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { manufacturerSchema } from "@/lib/admin-validation";

/** POST /api/admin/manufacturers — add a manufacturer. */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    const input = manufacturerSchema.parse(await request.json().catch(() => null));

    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.manufacturer.create({
        data: {
          name: input.name,
          country: input.country || null,
          warrantyMonths: input.warrantyMonths,
          contactName: input.contactName || null,
          contactEmail: input.contactEmail || null,
          contactPhone: input.contactPhone || null,
        },
      });
      await writeAudit(
        {
          actorId: actor.id,
          action: "CREATE",
          targetType: "Manufacturer",
          targetId: m.id,
          targetLabel: m.name,
          details: `Warranty ${m.warrantyMonths} months`,
        },
        tx,
      );
      return m;
    });

    return NextResponse.json({ manufacturer: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
