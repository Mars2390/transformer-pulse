import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole, AuthError } from "@/lib/auth";

/**
 * PATCH /api/alerts/[id] — acknowledge an alert.
 *
 * Acknowledging is a safe manager write: it records who read the alert and
 * when, and moves it out of the active list. It does NOT touch any lifecycle
 * event or hash — the custody chain is never written by this route.
 */
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const { id } = await context.params;

    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) {
      return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    }

    // A manager may only clear alerts for their own region.
    if (user.role === "MANAGER" && user.region && alert.region !== user.region) {
      return NextResponse.json({ error: "That alert is not in your region." }, { status: 403 });
    }

    await prisma.alert.update({
      where: { id },
      data: { acknowledged: true, acknowledgedById: user.id, acknowledgedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not acknowledge the alert." }, { status: 500 });
  }
}
