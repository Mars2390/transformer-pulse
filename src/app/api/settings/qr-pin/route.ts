import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

const pin = z.string().regex(/^\d{4}$/, "The PIN must be four digits.");

/**
 * The QR access PIN.
 *
 * Stated plainly, because it should not be mistaken for the security control it
 * resembles: this is a SHARED four-digit secret, and a shared secret has no
 * accountability — it cannot tell you WHO opened the scanner, only that someone
 * knew the number. Within a week of issue, everyone at the depot knows it.
 *
 * The real control is the one already in place: the story page requires a
 * signed-in KPLC account, so a scanned code shows a stranger a login screen.
 * This PIN is a deterrent on the in-app scanner, nothing more. It is stored
 * hashed anyway, because a weak secret sitting readable in the database and in
 * every backup of it is worse than a weak secret.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    const body = (await request.json().catch(() => null)) as { pin?: string } | null;
    const parsed = pin.safeParse(body?.pin ?? "");
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 422 });
    }

    const hash = await bcrypt.hash(parsed.data, 10);
    await prisma.appSetting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", qrAccessPinHash: hash, updatedById: actor.id },
      update: { qrAccessPinHash: hash, updatedById: actor.id },
    });

    await writeAudit({
      actorId: actor.id,
      action: "EDIT",
      targetType: "McpSettings",
      targetId: "singleton",
      targetLabel: "QR access PIN",
      details: `${actor.name} changed the QR scanner PIN. The value itself is stored hashed and is not recoverable from the database.`,
    });

    return NextResponse.json({ ok: true, message: "QR PIN updated." });
  } catch (error) {
    return apiError(error);
  }
}

/** PUT — check a PIN. Any signed-in user, because they are already authenticated. */
export async function PUT(request: Request) {
  try {
    await requireApiUser();
    const body = (await request.json().catch(() => null)) as { pin?: string } | null;
    const supplied = String(body?.pin ?? "");

    const setting = await prisma.appSetting.findUnique({ where: { id: "singleton" } });

    // No PIN configured yet means the factory default. Documented rather than
    // hidden, because an undocumented default is the one nobody ever changes.
    if (!setting?.qrAccessPinHash) {
      return NextResponse.json({ ok: supplied === "0000", usingDefault: true });
    }

    const ok = await bcrypt.compare(supplied, setting.qrAccessPinHash);
    return NextResponse.json({ ok, usingDefault: false });
  } catch (error) {
    return apiError(error);
  }
}
