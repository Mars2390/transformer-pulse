import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { promoteUnits } from "@/lib/inspection-promote";

/**
 * POST /api/inspections/promote — turn staged inspections into transformers.
 *
 * Deliberately batched by the caller rather than doing all 1,100 in one
 * request. Each promotion is a transaction that writes a transformer, a genesis
 * event and a chain head; a thousand of those in one HTTP request is a request
 * that times out halfway with no way to know what landed. The client sends 50
 * at a time and can report honest progress.
 */

const schema = z.object({
  keys: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const { keys } = schema.parse(await request.json().catch(() => null));

    const result = await promoteUnits(keys, { id: actor.id, name: actor.name });

    if (result.promoted > 0) {
      await writeAudit({
        actorId: actor.id,
        action: "CREATE",
        targetType: "Transformer",
        targetId: "bulk-promotion",
        targetLabel: `${result.promoted} transformers`,
        details:
          `Promoted ${result.promoted} transformer(s) from the KPLC inspection register ` +
          `(Nairobi West). ${result.skipped} skipped, ${result.failed} failed.`,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
