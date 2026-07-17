import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, AuthError } from "@/lib/auth";
import { verifyChain, type ChainLink } from "@/lib/chain";

/**
 * GET /api/transformers/[id]/verify — recompute the whole custody chain.
 *
 * This does the real work: it reads every event oldest-first and recomputes
 * each hash from the previous one. It is not a stored "verified" flag — it is
 * the actual arithmetic, run fresh on every call. That is what makes the green
 * badge mean something, and what lets the demo edit a row and watch it turn red.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser();
    const { id } = await context.params;

    const events = await prisma.lifecycleEvent.findMany({
      where: { transformerId: id },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true, hash: true, prevHash: true, transformerId: true,
        type: true, toStatus: true, userId: true, occurredAt: true,
        lat: true, lng: true, vehiclePlate: true, driverName: true, notes: true,
      },
    });

    if (events.length === 0) {
      return NextResponse.json({ error: "Transformer not found." }, { status: 404 });
    }

    const result = verifyChain(events as ChainLink[]);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Verify failed:", error);
    return NextResponse.json({ error: "Could not verify the chain." }, { status: 500 });
  }
}
