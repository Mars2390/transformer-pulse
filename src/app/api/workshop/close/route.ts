import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { closeRepair } from "@/lib/repair";

/**
 * POST /api/workshop/close — finish a repair, one way or the other.
 *
 * A successful repair writes REPAIRED and the unit is ready to go back to a
 * store. A failed one writes REPAIR_FAILED, condemns the transformer, checks
 * the store for a replacement, raises a supply request for the site, and — if
 * nothing of that rating is free — says so at CRITICAL.
 *
 * That last part is the point. Paper closes a fault when the unit is carted
 * away; the customers are still dark.
 */

const schema = z.object({
  repairId: z.string().min(1),
  faultCauseConfirmed: z.string().trim().min(3, "State what the workshop actually found."),
  repairActions: z.string().trim().max(2000).optional(),
  partsReplaced: z.string().trim().max(1000).optional(),
  repairCostKes: z.coerce.number().min(0).max(50_000_000).optional(),
  repairWarrantyMonths: z.coerce.number().int().min(0).max(60).optional(),
  workshopTechnician: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  successful: z.boolean(),
  failureReason: z.string().trim().max(500).optional(),
  /**
   * Post-repair test. Required when the repair succeeded: the state machine
   * will not accept REPAIRED without it, and that is deliberate — this unit is
   * about to go back on a pole above somebody's house.
   */
  test: z.object({
    oilBdvKv: z.coerce.number().min(0).max(200).optional(),
    insulationResistanceHvMohm: z.coerce.number().min(0).optional(),
    insulationResistanceLvMohm: z.coerce.number().min(0).optional(),
    turnsRatioDeviationPct: z.coerce.number().min(-100).max(100).optional(),
    passed: z.boolean(),
    remarks: z.string().trim().max(500).optional(),
  }).optional(),
}).refine((v) => v.successful || (v.failureReason && v.failureReason.length > 3), {
  message: "A condemned transformer needs a reason. Somebody will ask why it was scrapped.",
  path: ["failureReason"],
}).refine((v) => !v.successful || v.test != null, {
  message: "A successful repair needs a post-repair test. The unit is going back on a pole.",
  path: ["test"],
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const input = schema.parse(await request.json().catch(() => null));

    const result = await closeRepair(input.repairId, input, actor);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /Repair record not found/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return apiError(error);
  }
}
