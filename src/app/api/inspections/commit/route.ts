import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { commitInspections } from "@/lib/inspection-import";

/**
 * POST /api/inspections/commit — write the register.
 *
 * Safe to run twice. Report IDs are unique, so a re-uploaded file skips every
 * row it already holds rather than duplicating a year of fieldwork.
 */

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 25 MB." }, { status: 413 });
    }

    const result = await commitInspections(await file.arrayBuffer(), file.name, {
      id: actor.id,
      name: actor.name,
    });

    await writeAudit({
      actorId: actor.id,
      action: "CREATE",
      targetType: "Transformer",
      targetId: result.batchId,
      targetLabel: file.name,
      details:
        `Inspection register imported: ${result.imported} matched, ${result.staged} staged, ` +
        `${result.duplicate} already present, ${result.flagged} flagged for review, ` +
        `${result.conflictsRaised} conflicts raised.`,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /inspection register|no data rows/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return apiError(error);
  }
}
