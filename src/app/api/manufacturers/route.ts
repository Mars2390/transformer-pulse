import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { manufacturerSchema } from "@/lib/admin-validation";

/**
 * POST /api/manufacturers — add a supplier mid-receipt.
 *
 * Distinct from /api/admin/manufacturers, which stays ADMIN-only for the full
 * management screen. This one exists because of a specific failure: a lorry
 * arrives from a supplier nobody has entered, and the keeper's only options are
 * to guess, to file it under "Unknown", or to abandon the receipt and telephone
 * an administrator. All three produce a worse record than letting them type the
 * name on the spot.
 *
 * It is not a hole in the admin screen. Only a name, country, warranty length
 * and contact can be set; the row is audited with the creator's name; and a
 * duplicate returns the EXISTING supplier rather than creating a second one,
 * because two "TELK" rows is the actual risk here, not an unauthorised insert.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "MANAGER", "ADMIN", "FIELD_ENGINEER");
    const input = manufacturerSchema.parse(await request.json().catch(() => null));

    // Case-insensitive, because "Telk" and "TELK" are one supplier and a second
    // row would quietly split a manufacturer's warranty history in two.
    const existing = await prisma.manufacturer.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" } },
      select: { id: true, name: true, country: true },
    });
    if (existing) {
      return NextResponse.json({
        manufacturer: existing,
        reused: true,
        message: `${existing.name} was already on the list — selected it instead of adding a second one.`,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.manufacturer.create({
        data: {
          name: input.name,
          country: input.country || null,
          warrantyMonths: input.warrantyMonths,
          contactName: input.contactName || null,
          contactEmail: input.contactEmail || null,
          contactPhone: input.contactPhone || null,
        },
        select: { id: true, name: true, country: true },
      });
      await writeAudit(
        {
          actorId: actor.id,
          action: "CREATE",
          targetType: "Manufacturer",
          targetId: m.id,
          targetLabel: m.name,
          details: `${actor.name} added ${m.name}${input.country ? ` (${input.country})` : ""} while receiving. Warranty ${input.warrantyMonths} months.`,
        },
        tx,
      );
      return m;
    });

    return NextResponse.json({ manufacturer: created, reused: false }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
