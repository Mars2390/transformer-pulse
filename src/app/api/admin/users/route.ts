import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPin, requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { adminCreateUserSchema } from "@/lib/admin-validation";

/**
 * POST /api/admin/users — create a staff account. Admins only.
 *
 * Role decides access, full stop. The email is only an identifier — it never
 * grants a dashboard. A field engineer with an @kplc.co.ke address still sees
 * only /field.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    const input = adminCreateUserSchema.parse(await request.json().catch(() => null));

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }

    // A store keeper without a store sees an empty inventory. A manager or field
    // engineer without a region sees nothing scoped. Refuse both rather than
    // ship a silently-blank dashboard.
    if (input.role === "STORE_KEEPER" && !input.storeId) {
      return NextResponse.json(
        { error: "A store keeper must be assigned to a store." },
        { status: 422 },
      );
    }
    if ((input.role === "MANAGER" || input.role === "FIELD_ENGINEER") && !input.region) {
      return NextResponse.json(
        { error: "A manager or field engineer must be assigned to a region." },
        { status: 422 },
      );
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone || null,
          role: input.role,
          region: input.role === "STORE_KEEPER" ? null : input.region || null,
          storeId: input.role === "STORE_KEEPER" ? input.storeId || null : null,
          pinHash: await hashPin(input.pin),
        },
        select: { id: true, name: true, email: true, role: true },
      });
      await writeAudit(
        {
          actorId: actor.id,
          action: "CREATE",
          targetType: "User",
          targetId: created.id,
          targetLabel: created.name,
          details: `Created ${created.role} account (${created.email})`,
        },
        tx,
      );
      return created;
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
