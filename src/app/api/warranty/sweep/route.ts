import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { sweepWarranties, summariseExpiring, WARN_DAYS, CRITICAL_DAYS } from "@/lib/warranty-sweep";
import { regionWhere } from "@/lib/region-scope";

/**
 * GET  /api/warranty/sweep — what the sweep WOULD raise. Read-only.
 * POST /api/warranty/sweep — actually raise the alerts.
 *
 * Split by verb deliberately. A manager wants to see the numbers without
 * generating three hundred notifications by opening a page, and a scheduled job
 * wants to raise them without a human present. One endpoint doing both
 * depending on who called it is how a dashboard refresh ends up spamming an
 * alert list.
 */

export async function GET() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const scope = regionWhere(user.region, user.role);
    const summary = await summariseExpiring(scope);

    return NextResponse.json({
      ...summary,
      thresholds: { warnDays: WARN_DAYS, criticalDays: CRITICAL_DAYS },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST() {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    // A regional manager sweeps their own region; an admin sweeps everything.
    const result = await sweepWarranties({
      region: user.role === "MANAGER" ? user.region : null,
    });

    return NextResponse.json({
      ...result,
      message:
        result.warned + result.critical + result.expired === 0
          ? "Nothing is within 90 days of expiry."
          : `${result.critical} within ${CRITICAL_DAYS} days, ${result.warned} within ${WARN_DAYS} days, ${result.expired} already expired. ${result.alreadyOpen} already had an open alert and were not raised again.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
