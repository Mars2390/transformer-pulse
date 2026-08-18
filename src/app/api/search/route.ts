import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, AuthError } from "@/lib/auth";
import { guard } from "@/lib/security/guard";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

/**
 * GET /api/search?q= — transformer lookup scoped to the caller's patch.
 *
 * Admin sees everything; everyone else is limited to their region. Returns the
 * minimum needed to render a result row and link to the story.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const perimeter = await guard(request, { rule: RATE_LIMITS.SEARCH });
    if (!perimeter.ok) return perimeter.response;
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";

    const scope = user.role === "ADMIN" ? {} : user.region ? { region: user.region } : {};

    const results = await prisma.transformer.findMany({
      where: {
        ...scope,
        ...(q
          ? {
              OR: [
                { gNumber: { contains: q, mode: "insensitive" } },
                { serialNumber: { contains: q, mode: "insensitive" } },
                { currentSiteName: { contains: q, mode: "insensitive" } },
                { manufacturer: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: {
        id: true, gNumber: true, serialNumber: true, ratingKva: true,
        status: true, currentSiteName: true, manufacturer: { select: { name: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 1, select: { type: true, occurredAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
    });

    return NextResponse.json({
      results: results.map((tx) => ({
        id: tx.id,
        gNumber: tx.gNumber,
        serialNumber: tx.serialNumber,
        ratingKva: tx.ratingKva,
        status: tx.status,
        site: tx.currentSiteName,
        manufacturer: tx.manufacturer.name,
        lastEventType: tx.events[0]?.type ?? null,
        lastEventISO: tx.events[0]?.occurredAt.toISOString() ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
