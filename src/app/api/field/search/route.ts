import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole, AuthError } from "@/lib/auth";
import { regionWhere } from "@/lib/region-scope";
import { guard } from "@/lib/security/guard";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

/**
 * GET /api/field/search?q= — find a transformer to act on, scoped to the
 * engineer's region. Returns just enough to pick an action.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "ADMIN");
    const perimeter = await guard(request, { rule: RATE_LIMITS.SEARCH });
    if (!perimeter.ok) return perimeter.response;
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

    const results = await prisma.transformer.findMany({
      where: {
        ...regionWhere(actor.region, actor.role),
        ...(q
          ? {
              OR: [
                { gNumber: { contains: q, mode: "insensitive" } },
                { serialNumber: { contains: q, mode: "insensitive" } },
                { currentSiteName: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true, gNumber: true, serialNumber: true, ratingKva: true,
        status: true, currentSiteName: true,
        events: { orderBy: { occurredAt: "desc" }, take: 1, select: { type: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });

    return NextResponse.json({
      results: results.map((tx) => ({
        id: tx.id,
        gNumber: tx.gNumber,
        serialNumber: tx.serialNumber,
        ratingKva: tx.ratingKva,
        status: tx.status,
        site: tx.currentSiteName,
        lastEventType: tx.events[0]?.type ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
