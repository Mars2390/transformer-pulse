import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { guard } from "@/lib/security/guard";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { formatGNumber } from "@/lib/format";

/**
 * GET /api/transformers/search?q=…
 *
 * A small type-ahead for the load-data confirm screen: when a flat table has no
 * identity of its own, the engineer needs to attach it to a transformer on the
 * register. Matches G-Number, serial or site, newest first, capped small.
 */
export async function GET(request: Request) {
  try {
    await requireApiRole("ADMIN", "MANAGER");
    const perimeter = await guard(request, { rule: RATE_LIMITS.SEARCH });
    if (!perimeter.ok) return perimeter.response;
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const results = await prisma.transformer.findMany({
      where: {
        OR: [
          { gNumber: { contains: q, mode: "insensitive" } },
          { serialNumber: { contains: q, mode: "insensitive" } },
          { currentSiteName: { contains: q, mode: "insensitive" } },
          { substationName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true, gNumber: true, serialNumber: true, ratingKva: true,
        currentSiteName: true, region: true,
      },
      take: 8,
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      results: results.map((t) => ({
        id: t.id,
        label: formatGNumber(t.gNumber) ?? t.serialNumber,
        detail: [`${t.ratingKva} kVA`, t.currentSiteName, t.region].filter(Boolean).join(" · "),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
