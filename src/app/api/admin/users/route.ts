import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, hashPin, requireApiRole } from "@/lib/auth";
import { createUserSchema, fieldErrors } from "@/lib/validation";

/**
 * POST /api/admin/users — create a staff account. Admins only.
 */
export async function POST(request: Request) {
  try {
    await requireApiRole("ADMIN");

    const body = await request.json().catch(() => null);
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Some fields need fixing.", fields: fieldErrors(parsed.error) },
        { status: 422 },
      );
    }

    const input = parsed.data;

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }

    // A store keeper without a store cannot see any inventory — the dashboard
    // would silently show nothing. Refuse it here rather than ship a confusing
    // empty screen.
    if (input.role === "STORE_KEEPER" && !input.storeId) {
      return NextResponse.json(
        { error: "A store keeper must be assigned to a store." },
        { status: 422 },
      );
    }

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        staffNumber: input.staffNumber || null,
        role: input.role,
        region: input.region || null,
        storeId: input.storeId || null,
        pinHash: await hashPin(input.pin),
      },
      select: { id: true, name: true, email: true, role: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create user failed:", error);
    return NextResponse.json(
      { error: "Something went wrong on our side." },
      { status: 500 },
    );
  }
}
