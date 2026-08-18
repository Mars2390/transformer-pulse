import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { backfillLocations } from "@/lib/security/geo";

/**
 * POST /api/security/geo — resolve locations for events that lack one.
 *
 * Explicitly a separate, admin-triggered call rather than something that
 * happens while an event is written. See lib/security/geo.ts for why a
 * third-party lookup must never sit inside the sign-in path.
 */
export async function POST() {
  try {
    await requireApiRole("ADMIN");
    const result = await backfillLocations(25);
    return NextResponse.json({
      ...result,
      message: `Resolved ${result.addresses} address(es), updating ${result.events} event(s).`,
    });
  } catch (error) {
    return apiError(error);
  }
}
