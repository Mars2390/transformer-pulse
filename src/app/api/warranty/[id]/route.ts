import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";

/**
 * PATCH /api/warranty/[id] — move a claim through its lifecycle.
 *
 * OPEN → SUBMITTED (records the manufacturer's RMA reference) → APPROVED or
 * REJECTED → CLOSED. Managers own this; it is money owed to KPLC, and it never
 * touches a lifecycle event or the custody chain.
 */
const schema = z.object({
  status: z.enum(["OPEN", "SUBMITTED", "APPROVED", "REJECTED", "CLOSED"]),
  referenceNo: z.string().trim().max(60).optional().or(z.literal("")),
  resolutionNotes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const { id } = await context.params;
    const input = schema.parse(await request.json().catch(() => null));

    const claim = await prisma.warrantyClaim.findUnique({
      where: { id },
      include: { transformer: { select: { region: true } } },
    });
    if (!claim) return NextResponse.json({ error: "Claim not found." }, { status: 404 });

    if (
      user.role === "MANAGER" &&
      user.region &&
      claim.transformer.region &&
      claim.transformer.region !== user.region
    ) {
      return NextResponse.json({ error: "That claim is not in your region." }, { status: 403 });
    }

    if (input.status === "SUBMITTED" && !input.referenceNo) {
      return NextResponse.json(
        { error: "Record the manufacturer's RMA reference when you submit a claim." },
        { status: 422 },
      );
    }

    const terminal = input.status === "APPROVED" || input.status === "REJECTED" || input.status === "CLOSED";

    await prisma.warrantyClaim.update({
      where: { id },
      data: {
        status: input.status,
        referenceNo: input.referenceNo || claim.referenceNo,
        resolutionNotes: input.resolutionNotes || claim.resolutionNotes,
        submittedAt: input.status === "SUBMITTED" && !claim.submittedAt ? new Date() : claim.submittedAt,
        resolvedAt: terminal ? new Date() : null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
