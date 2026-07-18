import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { storeSchema } from "@/lib/admin-validation";

/** POST /api/admin/stores — add a store. */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    const input = storeSchema.parse(await request.json().catch(() => null));

    const existing = await prisma.store.findUnique({ where: { code: input.code } });
    if (existing) {
      return NextResponse.json({ error: "That store code is already in use." }, { status: 409 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.store.create({
        data: {
          name: input.name,
          code: input.code,
          region: input.region,
          county: input.county,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        },
      });
      await writeAudit(
        {
          actorId: actor.id,
          action: "CREATE",
          targetType: "Store",
          targetId: s.id,
          targetLabel: s.name,
          details: `${s.code} · ${s.region}`,
        },
        tx,
      );
      return s;
    });

    return NextResponse.json({ store: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
