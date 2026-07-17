import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * POST /api/auth/logout
 *
 * POST, not GET, on purpose: a GET logout can be triggered by any page that
 * embeds <img src="/api/auth/logout">, which would sign your users out at
 * random. Actions that change state must never be reachable by a link.
 */
export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
