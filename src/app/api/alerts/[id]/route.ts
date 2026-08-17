import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inRegion } from "@/lib/region-scope";
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
    // STORE_MANAGER added. They can now SEE alerts in the bell, and a role that
    // can see a notification but cannot clear it has a badge that never goes
    // down — which is the fastest way to teach somebody the badge is noise.
    const user = await requireApiRole("MANAGER", "STORE_MANAGER", "ADMIN");
    const { id } = await context.params;

    const alert = await prisma.alert.findUnique({
      where: { id },
      include: { transformer: { select: { currentStoreId: true, region: true } } },
    });
    if (!alert) {
      return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    }

    // A store manager clears their own store's alerts, by foreign key.
    if (user.role === "STORE_MANAGER") {
      if (!user.storeId || alert.transformer.currentStoreId !== user.storeId) {
        return NextResponse.json(
          { error: "That alert belongs to another store." },
          { status: 403 },
        );
      }
    }

    // A regional manager clears their own region's.
    //
    // `inRegion` rather than a string equality test, and that is a fix rather
    // than a tidy-up: the LIST query matches regions with `contains` on the
    // base token, so a manager for "Nairobi North" is shown alerts filed under
    // "Nairobi North West" — and the old `alert.region !== user.region` here
    // then refused to let them clear the very rows they had just been shown.
    // Seeing something you cannot dismiss is how a bell fills up permanently.
    if (user.role === "MANAGER" && !inRegion(alert.region, user.region, user.role)) {
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
