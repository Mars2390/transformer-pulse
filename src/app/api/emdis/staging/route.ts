import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { listStagedDatasets, approveStagedDataset, discardStagedDataset } from "@/lib/emdis-datasets";

/**
 * The staging queue for load data whose transformer could not be identified.
 *
 *   GET                                    what is waiting
 *   POST   {datasetId, transformerId}      approve — attach, re-analyse, admit
 *   DELETE ?id=...                         discard
 *
 * Both decisions are audited. Approving is the act of asserting that a set of
 * readings belongs to a particular transformer, and every number that transformer
 * reports afterwards rests on that assertion being right — so it is recorded
 * with the name of whoever made it.
 */

export async function GET() {
  try {
    await requireApiRole("ADMIN", "MANAGER");
    const datasets = await listStagedDatasets();
    return NextResponse.json({
      datasets,
      totals: {
        datasets: datasets.length,
        readings: datasets.reduce((s, d) => s + d.readingCount, 0),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const body = await request.json().catch(() => ({}));
    const datasetId = typeof body.datasetId === "string" ? body.datasetId : null;
    const transformerId = typeof body.transformerId === "string" ? body.transformerId : null;

    if (!datasetId || !transformerId) {
      return NextResponse.json(
        { error: "Both a staged dataset and the transformer it belongs to are required." },
        { status: 400 },
      );
    }

    const result = await approveStagedDataset(datasetId, transformerId, {
      id: actor.id,
      name: actor.name,
    });

    await writeAudit({
      actorId: actor.id,
      action: "EDIT",
      targetType: "EmdisDataset",
      targetId: datasetId,
      targetLabel: result.transformerLabel,
      details:
        `Approved staged load data onto ${result.transformerLabel}: ` +
        `${result.readings.toLocaleString()} readings, ${result.alertsRaised} alert(s) raised` +
        (result.recomputed
          ? `, re-analysed against the register's ${result.ratingKva} kVA rating.`
          : "."),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && /no longer exists|not on the register|already part of/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "No dataset given." }, { status: 400 });

    const result = await discardStagedDataset(id);

    await writeAudit({
      actorId: actor.id,
      action: "DELETE",
      targetType: "EmdisDataset",
      targetId: id,
      targetLabel: id,
      details: `Discarded staged load data: ${result.readings.toLocaleString()} readings, never admitted to the analysis.`,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && /no longer exists|cannot be discarded/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return apiError(error);
  }
}
