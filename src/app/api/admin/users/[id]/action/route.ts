import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPin, requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { generatePin, userActionSchema } from "@/lib/admin-validation";

/**
 * POST /api/admin/users/[id]/action — disable, enable, unlock, or reset PIN.
 *
 * Reset returns the new PIN ONCE in the response body. It is never stored in
 * plain text and never shown again — the admin reads it to the user in person.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("ADMIN");
    const { id } = await context.params;
    const { action } = userActionSchema.parse(await request.json().catch(() => null));

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

    if (action === "disable" && id === actor.id) {
      return NextResponse.json({ error: "You cannot disable your own account." }, { status: 422 });
    }

    let newPin: string | null = null;

    await prisma.$transaction(async (tx) => {
      if (action === "disable") {
        await tx.user.update({ where: { id }, data: { active: false } });
      } else if (action === "enable") {
        await tx.user.update({ where: { id }, data: { active: true } });
      } else if (action === "unlock") {
        await tx.user.update({ where: { id }, data: { lockedUntil: null, failedAttempts: 0 } });
      } else if (action === "resetPin") {
        newPin = generatePin();
        await tx.user.update({
          where: { id },
          data: { pinHash: await hashPin(newPin), mustChangePin: true, lockedUntil: null, failedAttempts: 0 },
        });
      }

      await writeAudit(
        {
          actorId: actor.id,
          action: action === "resetPin" ? "RESET_PIN" : (action.toUpperCase() as "DISABLE" | "ENABLE" | "UNLOCK"),
          targetType: "User",
          targetId: id,
          targetLabel: user.name,
          details:
            action === "resetPin"
              ? "PIN reset; user must change it on next sign-in"
              : `Account ${action}d`,
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true, newPin });
  } catch (error) {
    return apiError(error);
  }
}
