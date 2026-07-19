import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole, AuthError } from "@/lib/auth";
import { regionWhere } from "@/lib/region-scope";

/**
 * GET /api/alerts — unacknowledged alerts for the caller's region.
 *
 * Powers the header bell's live count and the dashboard panel. Managers see
 * their region; an admin (no region) sees everything.
 */
export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");

    const where =
      regionWhere(user.region, user.role);

    const [alerts, unreadCount] = await Promise.all([
      prisma.alert.findMany({
        where: { ...where, acknowledged: false },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 30,
        include: { transformer: { select: { id: true, gNumber: true, serialNumber: true } } },
      }),
      prisma.alert.count({ where: { ...where, acknowledged: false } }),
    ]);

    return NextResponse.json({
      unreadCount,
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
