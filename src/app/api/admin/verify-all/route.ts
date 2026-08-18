import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole, AuthError } from "@/lib/auth";
import { verifyChain, type ChainLink } from "@/lib/chain";

/**
 * GET /api/admin/verify-all — recompute EVERY transformer's custody chain.
 *
 * This is the system-wide integrity check: it walks every event of every
 * transformer and recomputes each hash. It is the arithmetic behind the claim
 * that the whole register is untampered — not a stored flag, the real sums, run
 * on demand.
 */
export async function GET() {
  try {
    await requireApiRole("ADMIN");

    const transformers = await prisma.transformer.findMany({
      select: {
        id: true,
        gNumber: true,
        serialNumber: true,
        events: {
          orderBy: { occurredAt: "asc" },
          select: {
            id: true, hash: true, prevHash: true, transformerId: true,
            type: true, toStatus: true, userId: true, occurredAt: true,
            lat: true, lng: true, vehiclePlate: true, driverName: true, notes: true,
            // v2 hashes fromStatus, and verifyChain reads the version off the row.
            fromStatus: true, hashVersion: true,
          },
        },
      },
    });

    const broken: { id: string; label: string; reason: string; brokenAtEventId: string | null }[] = [];
    let totalEvents = 0;

    for (const tx of transformers) {
      totalEvents += tx.events.length;
      if (tx.events.length === 0) continue;
      const result = verifyChain(tx.events as ChainLink[]);
      if (!result.valid) {
        broken.push({
          id: tx.id,
          label: tx.gNumber ?? tx.serialNumber,
          reason: result.reason ?? "Chain broken.",
          brokenAtEventId: result.brokenAtEventId,
        });
      }
    }

    return NextResponse.json({
      checkedTransformers: transformers.length,
      checkedEvents: totalEvents,
      valid: broken.length === 0,
      broken,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Verify-all failed:", error);
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}
