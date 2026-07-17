import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";

/**
 * GET /api/transformers/suggest-gnumber — the next free G-Number.
 *
 * Sequential per year: G-2026-00001, G-2026-00002. We read the highest issued
 * this year and add one.
 *
 * Two keepers clicking at the same instant could be offered the same number.
 * The unique index catches that and the form asks for another — which is the
 * right trade. A database sequence would burn a number on every abandoned form,
 * and KPLC's G-Number register must not have holes in it.
 */
export async function GET() {
  try {
    await requireApiRole("STORE_KEEPER", "ADMIN");

    const year = new Date().getFullYear();
    const latest = await prisma.transformer.findFirst({
      where: { gNumber: { startsWith: `G-${year}-` } },
      orderBy: { gNumber: "desc" },
      select: { gNumber: true },
    });

    const lastNumber = latest?.gNumber ? Number(latest.gNumber.split("-")[2] ?? 0) : 0;
    const suggestion = `G-${year}-${String(lastNumber + 1).padStart(5, "0")}`;

    return NextResponse.json({ suggestion });
  } catch (error) {
    return apiError(error);
  }
}
