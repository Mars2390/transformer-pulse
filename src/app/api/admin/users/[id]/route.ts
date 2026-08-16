import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPin, requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit, describeChanges } from "@/lib/audit";
import { adminEditUserSchema } from "@/lib/admin-validation";

const USER_LABELS = { name: "name", role: "role", region: "region", phone: "phone" };

/** PATCH /api/admin/users/[id] — edit an account (never the email or PIN). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("ADMIN");
    const { id } = await context.params;
    const input = adminEditUserSchema.parse(await request.json().catch(() => null));

    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "User not found." }, { status: 404 });

    // Same rule on edit: promoting somebody to store manager without giving
    // them a store would leave them staring at an empty system.
    if ((input.role === "STORE_KEEPER" || input.role === "STORE_MANAGER") && !input.storeId) {
      return NextResponse.json({ error: "A store keeper must be assigned to a store." }, { status: 422 });
    }
    if ((input.role === "MANAGER" || input.role === "FIELD_ENGINEER") && !input.region) {
      return NextResponse.json({ error: "A manager or field engineer must have a region." }, { status: 422 });
    }

    const after = {
      name: input.name,
      role: input.role,
      region:
        input.role === "STORE_KEEPER" || input.role === "STORE_MANAGER"
          ? null
          : input.region || null,
      storeId:
        input.role === "STORE_KEEPER" || input.role === "STORE_MANAGER"
          ? input.storeId || null
          : null,
      phone: input.phone || null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: after });
      const details = describeChanges(
        before as unknown as Record<string, unknown>,
        after,
        USER_LABELS,
      );
      await writeAudit(
        {
          actorId: actor.id,
          action: "EDIT",
          targetType: "User",
          targetId: id,
          targetLabel: input.name,
          details: details || "No field values changed",
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/admin/users/[id] — only when the account has NO recorded history.
 *
 * A user who has recorded events, tests or claims is woven into the audit
 * trail; deleting them would orphan those records or force a cascade that
 * erases evidence. Those accounts are disabled, never deleted.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("ADMIN");
    const { id } = await context.params;

    if (id === actor.id) {
      return NextResponse.json({ error: "You cannot delete your own account." }, { status: 422 });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: { _count: { select: { events: true, tests: true, claimsRaised: true } } },
    });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const history = user._count.events + user._count.tests + user._count.claimsRaised;
    if (history > 0) {
      return NextResponse.json(
        {
          error: `${user.name} has ${history} recorded action${history === 1 ? "" : "s"} in the system and cannot be deleted. Disable the account instead.`,
        },
        { status: 409 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await writeAudit(
        {
          actorId: actor.id,
          action: "DELETE",
          targetType: "User",
          targetId: id,
          targetLabel: user.name,
          details: `Deleted ${user.role} account (${user.email})`,
        },
        tx,
      );
      await tx.user.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
