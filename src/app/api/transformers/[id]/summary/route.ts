import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, AuthError } from "@/lib/auth";
import { computeWarranty, warrantyLabel } from "@/lib/warranty";

/**
 * GET /api/transformers/[id]/summary — the quick-view payload.
 *
 * Just enough for the slide-out panel: identity, last test, warranty, and the
 * last three events. Deliberately small — the panel must open instantly when a
 * store keeper clicks a row, so this never loads the full history.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser();
    const { id } = await context.params;

    const tx = await prisma.transformer.findUnique({
      where: { id },
      include: {
        manufacturer: { select: { name: true } },
        currentStore: { select: { name: true } },
        tests: { orderBy: { testedAt: "desc" }, take: 1 },
        events: {
          orderBy: { occurredAt: "desc" },
          take: 3,
          include: { user: { select: { name: true } } },
        },
      },
    });

    if (!tx) {
      return NextResponse.json({ error: "Transformer not found." }, { status: 404 });
    }

    const warranty = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
    const intake = tx.tests.find((t) => t.stage === "STORE_INTAKE") ?? tx.tests[0] ?? null;

    return NextResponse.json({
      id: tx.id,
      gNumber: tx.gNumber,
      serialNumber: tx.serialNumber,
      manufacturer: tx.manufacturer.name,
      ratingKva: tx.ratingKva,
      status: tx.status,
      receivedAtISO: tx.createdAt.toISOString(),
      lastTest: intake
        ? { passed: intake.passed, stage: intake.stage, testedAtISO: intake.testedAt.toISOString() }
        : null,
      warranty: { label: warrantyLabel(warranty), state: warranty.state },
      recentEvents: tx.events.map((e) => ({
        id: e.id,
        type: e.type,
        userName: e.user.name,
        occurredAtISO: e.occurredAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Summary failed:", error);
    return NextResponse.json({ error: "Could not load the summary." }, { status: 500 });
  }
}
