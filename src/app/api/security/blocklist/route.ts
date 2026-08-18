import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { blockIp, unblockIp } from "@/lib/security/blocklist";
import { assertSameOrigin } from "@/lib/security/csrf";

/**
 * GET    /api/security/blocklist — currently blocked addresses.
 * POST   /api/security/blocklist — block one.
 * DELETE /api/security/blocklist — release one.
 *
 * Admin only. Blocking an address can take a whole carrier-NAT region of field
 * engineers off the system, so this is not a manager-level action.
 */

const blockSchema = z.object({
  ipAddress: z.string().trim().min(3).max(45),
  reason: z.string().trim().min(3, "Say why. A block with no reason cannot be reviewed.").max(300),
  durationMinutes: z.coerce.number().int().min(5).max(60 * 24 * 30).nullable().optional(),
});

export async function GET() {
  try {
    await requireApiRole("ADMIN");
    const blocks = await prisma.blockedIp.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { blockedBy: { select: { name: true } } },
    });
    return NextResponse.json({ blocks });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Request rejected." }, { status: 403 });
    }

    const input = blockSchema.parse(await request.json().catch(() => null));

    await blockIp({
      ipAddress: input.ipAddress,
      reason: input.reason,
      source: "MANUAL",
      blockedById: actor.id,
      durationMinutes: input.durationMinutes ?? null,
    });

    return NextResponse.json({
      ok: true,
      message: input.durationMinutes
        ? `${input.ipAddress} blocked for ${input.durationMinutes} minutes.`
        : `${input.ipAddress} blocked permanently. Review it — a permanent block on a mobile-carrier address can affect many users.`,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Request rejected." }, { status: 403 });
    }
    const { ipAddress } = z
      .object({ ipAddress: z.string().trim().min(3).max(45) })
      .parse(await request.json().catch(() => null));

    await unblockIp(ipAddress, actor.id);
    return NextResponse.json({ ok: true, message: `${ipAddress} released.` });
  } catch (error) {
    return apiError(error);
  }
}
