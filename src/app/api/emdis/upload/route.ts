import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { previewEmdis, commitEmdis } from "@/lib/emdis-import";
import type { CanonField } from "@/lib/universal-columns";

/**
 * EMDis load telemetry upload.
 *
 * POST ?mode=preview  read the export, write nothing
 * POST ?mode=commit   ingest, analyse, roll up hourly, raise alerts
 */

const MAX_BYTES = 40 * 1024 * 1024;

/** A form field that may hold JSON (the column overrides). Bad JSON is ignored. */
function parseJsonField(v: FormDataEntryValue | null): Record<string, string> | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const mode = new URL(request.url).searchParams.get("mode") ?? "preview";

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 40 MB." }, { status: 413 });
    }
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      return NextResponse.json({ error: "Upload a .csv, .xlsx or .xls file." }, { status: 415 });
    }

    const buffer = await file.arrayBuffer();

    // Optional confirm-screen inputs, sent as JSON strings in the same form.
    const mappingOverride = parseJsonField(form.get("mapping")) as Record<string, CanonField> | null;
    const transformerId = (form.get("transformerId") as string) || null;
    const saveProfileName = (form.get("saveProfileName") as string) || null;

    if (mode === "preview") {
      return NextResponse.json(await previewEmdis(buffer, file.name, mappingOverride ?? undefined));
    }

    // The uploader saw the overlap warning on the confirm screen and chose to
    // go ahead. It never unlocks an exact duplicate — see CommitOptions.force.
    const force = form.get("force") === "true";

    const result = await commitEmdis(
      buffer, file.name,
      { id: actor.id, name: actor.name },
      { transformerId, mappingOverride: mappingOverride ?? undefined, saveProfileName, force },
    );

    await writeAudit({
      actorId: actor.id,
      action: "CREATE",
      targetType: "Transformer",
      targetId: result.batchId,
      targetLabel: file.name,
      details:
        `EMDis load data ingested: ${result.totalReadings} readings across ` +
        `${result.datasets.length} transformer block(s), ` +
        `${result.datasets.filter((d) => d.matched && !d.staged).length} matched to the register, ` +
        `${result.datasets.filter((d) => d.staged).length} staged for review, ` +
        `${result.skipped.length} refused as duplicate, ` +
        `${result.datasets.reduce((s, d) => s + d.alertsRaised, 0)} alert(s) raised.`,
    });

    // 201 only when something was actually created. A file whose every block
    // was refused as a duplicate created nothing, and reporting that as
    // "created" is how a client ends up telling a manager it worked.
    return NextResponse.json(result, { status: result.datasets.length ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && /EMDis blocks/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return apiError(error);
  }
}

/**
 * DELETE — moved to /api/emdis/datasets.
 *
 * Kept as an explicit redirect rather than removed, because the old handler
 * deleted the dataset and stopped there: the transformer's cached health score
 * went on quoting readings that no longer existed. Anything still calling this
 * URL is calling the version with that bug, and should be told so rather than
 * silently succeeding.
 */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  return NextResponse.json(
    {
      error:
        "Dataset deletion moved to /api/emdis/datasets, which also withdraws the alerts " +
        "raised from the data and rescores the transformer.",
      use: `/api/emdis/datasets?id=${id ?? "<dataset-id>"}`,
    },
    { status: 308, headers: { Location: `/api/emdis/datasets?id=${id ?? ""}` } },
  );
}
