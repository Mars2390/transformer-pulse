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

    const result = await commitEmdis(
      buffer, file.name,
      { id: actor.id, name: actor.name },
      { transformerId, mappingOverride: mappingOverride ?? undefined, saveProfileName },
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
        `${result.datasets.filter((d) => d.matched).length} matched to the register, ` +
        `${result.datasets.reduce((s, d) => s + d.alertsRaised, 0)} alert(s) raised.`,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /EMDis blocks/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return apiError(error);
  }
}

/** DELETE — remove a dataset and everything derived from it. */
export async function DELETE(request: Request) {
  try {
    await requireApiRole("ADMIN", "MANAGER");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "No dataset given." }, { status: 400 });

    const { prisma } = await import("@/lib/prisma");
    // Readings and rollups cascade. The LOAD_CHECK_RECORDED event on the chain
    // does NOT: it records that a check happened, and that remains true even
    // after the underlying readings are cleared.
    await prisma.emdisDataset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
