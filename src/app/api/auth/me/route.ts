import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * GET /api/auth/me
 *
 * Returns the signed-in user, or 401. Used by the client when it needs to know
 * who it is talking to without a full page load.
 */
export async function GET() {
  const user = await getSession();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.json({ user });
}
