import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit, describeChanges } from "@/lib/audit";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  region: z.string().trim().min(2).max(80).optional(),
  county: z.string().trim().min(2).max(80).optional(),
  kind: z.enum(["STORE", "WORKSHOP"]).optional(),
  active: z.boolean().optional(),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
});

/**
 * PATCH /api/admin/stores/[id] — rename, re-region, retype, enable or disable.
 *
 * The code is deliberately NOT editable. It is the human key printed on
 * paperwork and referenced by imports; renaming a store is a label change,
 * changing its code is a different store wearing the same clothes.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiRole("ADMIN");
    const { id } = await ctx.params;
    const input = patchSchema.parse(await request.json().catch(() => null));

    const before = await prisma.store.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Store not found." }, { status: 404 });

    // Turning a store into a workshop while it holds stock would silently
    // reclassify every unit on its shelf.
    if (input.kind && input.kind !== before.kind) {
      const held = await prisma.transformer.count({ where: { currentStoreId: id } });
      if (held > 0) {
        return NextResponse.json(
          {
            error: `${before.name} currently holds ${held} transformer${held === 1 ? "" : "s"}. Move them out before changing it to a ${input.kind.toLowerCase()}.`,
          },
          { status: 409 },
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.store.update({ where: { id }, data: input });
      await writeAudit(
        {
          actorId: actor.id,
          action: input.active === false ? "DISABLE" : input.active === true ? "ENABLE" : "EDIT",
          targetType: "Store",
          targetId: s.id,
          targetLabel: s.name,
          details: describeChanges(before, s, {
            name: "Name",
            region: "Region",
            county: "County",
            kind: "Kind",
            active: "Active",
          }),
        },
        tx,
      );
      return s;
    });

    return NextResponse.json({ store: updated });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * DELETE /api/admin/stores/[id] — only when nothing points at it.
 *
 * A store that ever held a transformer is part of that transformer's history,
 * and the chain has to have somewhere to point. Disabling is the answer for
 * everything else; deletion is for a store created by mistake this morning.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiRole("ADMIN");
    const { id } = await ctx.params;

    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });

    const [transformers, users, movementsFrom, movementsTo] = await Promise.all([
      prisma.transformer.count({ where: { currentStoreId: id } }),
      prisma.user.count({ where: { storeId: id } }),
      prisma.transactionRecord.count({ where: { fromId: id } }),
      prisma.transactionRecord.count({ where: { toId: id } }),
    ]);

    const blockers: string[] = [];
    if (transformers) blockers.push(`${transformers} transformer${transformers === 1 ? "" : "s"}`);
    if (users) blockers.push(`${users} user${users === 1 ? "" : "s"}`);
    const movements = movementsFrom + movementsTo;
    if (movements) blockers.push(`${movements} movement record${movements === 1 ? "" : "s"}`);

    if (blockers.length) {
      return NextResponse.json(
        {
          error: `${store.name} still has ${blockers.join(", ")} linked to it. Disable it instead — its history has to stay reachable.`,
        },
        { status: 409 },
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.store.delete({ where: { id } });
      await writeAudit(
        {
          actorId: actor.id,
          action: "DELETE",
          targetType: "Store",
          targetId: id,
          targetLabel: store.name,
          details: `${store.code} · ${store.region}. Nothing was linked to it.`,
        },
        tx,
      );
    });

    return NextResponse.json({ deleted: true, message: `${store.name} deleted.` });
  } catch (error) {
    return apiError(error);
  }
}
