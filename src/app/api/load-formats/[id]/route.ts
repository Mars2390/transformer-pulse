import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";

/** DELETE a saved column-mapping profile. Removing it only means the next file
 *  with those columns is re-mapped automatically — no telemetry is affected. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiRole("ADMIN");
    const { id } = await params;
    await prisma.columnMappingProfile.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
