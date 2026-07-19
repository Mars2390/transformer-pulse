import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { createSupplyRequest, checkStock } from "@/lib/repair";

/**
 * Supply requests — a site that needs a transformer and does not have the right
 * one.
 *
 * Raised by a field engineer or from a load analysis; approved by a manager.
 * Keeping those two acts separate is what stops the store being emptied by
 * whoever shouts loudest.
 */

const schema = z.object({
  siteName: z.string().trim().min(3, "Name the site."),
  substationCode: z.string().trim().max(40).optional(),
  region: z.string().trim().max(80).optional(),
  ratingKvaNeeded: z.coerce.number().int().refine(
    (v) => [50, 100, 200, 315, 500, 630, 1000].includes(v),
    "Choose a standard rating.",
  ),
  reason: z.enum(["TRANSFORMER_FAILED", "NO_SUPPLY_AT_SITE", "CAPACITY_UPGRADE", "RELOCATION"]),
  failedTransformerId: z.string().optional(),
  customersAffected: z.coerce.number().int().min(0).max(1_000_000).optional(),
  urgency: z.enum(["NORMAL", "HIGH", "EMERGENCY"]).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "STORE_KEEPER", "MANAGER", "ADMIN");
    const input = schema.parse(await request.json().catch(() => null));

    const req = await createSupplyRequest(input, actor);
    // Answer the obvious next question in the same breath: is there one?
    const stock = await checkStock(input.ratingKvaNeeded, input.region ?? actor.region);

    return NextResponse.json({ request: { id: req.id, reference: req.reference, status: req.status }, stock }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** GET — the queue, worst first. */
export async function GET(request: Request) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "STORE_KEEPER", "MANAGER", "ADMIN");
    const status = new URL(request.url).searchParams.get("status");

    const requests = await prisma.supplyRequest.findMany({
      where: status ? { status: status as never } : { status: { in: ["SUBMITTED", "APPROVED", "ALLOCATED"] } },
      orderBy: [{ urgency: "desc" }, { raisedAt: "asc" }],
      take: 200,
      include: {
        raisedBy: { select: { name: true } },
        allocations: { where: { status: { in: ["RESERVED", "DISPATCHED"] } }, select: { id: true } },
      },
    });

    return NextResponse.json({
      requests: requests.map((r) => ({
        id: r.id,
        reference: r.reference,
        siteName: r.siteName,
        ratingKvaNeeded: r.ratingKvaNeeded,
        reason: r.reason,
        urgency: r.urgency,
        status: r.status,
        customersAffected: r.customersAffected,
        raisedBy: r.raisedBy.name,
        raisedAt: r.raisedAt.toISOString().slice(0, 10),
        // How long the site has been waiting. The number that turns a queue
        // into a priority order.
        daysWaiting: Math.floor((Date.now() - r.raisedAt.getTime()) / 86_400_000),
        allocated: r.allocations.length > 0,
      })),
    });
    void actor;
  } catch (error) {
    return apiError(error);
  }
}
