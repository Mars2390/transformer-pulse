import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole, AuthError } from "@/lib/auth";
import { visibleTransformerWhere } from "@/lib/region-scope";
import { countPendingApprovals } from "@/lib/pending-approvals";

/**
 * GET /api/alerts — unacknowledged alerts for the caller's region.
 *
 * Powers the header bell's live count and the dashboard panel. Managers see
 * their region; an admin (no region) sees everything.
 */
export async function GET() {
  try {
    // STORE_MANAGER was missing here, which meant the role could be given an
    // approval queue and no way to be told anything was in it. Their alerts are
    // scoped by STORE, not by region — see below.
    const user = await requireApiRole("MANAGER", "STORE_MANAGER", "ADMIN");

    // Alerts reach a transformer through a relation, so the scope goes on the
    // relation. This replaces `regionWhere(user.region)`, which was wrong for a
    // store manager in exactly the way region scoping is always wrong for them:
    // it would have shown somebody at Ruaraka every alert in Nairobi North,
    // every other store's included.
    const where = { transformer: visibleTransformerWhere(user) };

    const [alerts, unreadCount, pending] = await Promise.all([
      prisma.alert.findMany({
        where: { ...where, acknowledged: false },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 30,
        include: { transformer: { select: { id: true, gNumber: true, serialNumber: true } } },
      }),
      prisma.alert.count({ where: { ...where, acknowledged: false } }),
      // Counted live, never stored — see src/lib/pending-approvals.ts. This is
      // what makes the badge clear itself the moment the last item is signed,
      // with no cleanup code anywhere that could be forgotten.
      countPendingApprovals(user),
    ]);

    return NextResponse.json({
      unreadCount,
      pending,
      // What the bell's badge shows: things that happened AND things waiting on
      // you. Kept as one number because a person glancing at a header wants to
      // know whether to look, not to do arithmetic across two badges.
      badgeCount: unreadCount + pending.total,
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        message: a.message,
        createdAtISO: a.createdAt.toISOString(),
        transformerId: a.transformer.id,
        gNumber: a.transformer.gNumber ?? a.transformer.serialNumber,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not load alerts." }, { status: 500 });
  }
}
