import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { editTransformerSchema } from "@/lib/validation";

/**
 * PATCH /api/transformers/[id] — correct or complete a transformer's nameplate.
 *
 * This edits STATIC PHYSICAL FACTS about the unit (rating, weights, temp class,
 * BIL, oil type…) — the kind of thing read off a rusty plate that may not have
 * been fully legible at intake. It is store keeper / admin work.
 *
 * It never writes, edits or deletes a LifecycleEvent, so the custody chain is
 * completely untouched — verify it before and after and it is identical. Every
 * edit is written to the admin audit trail instead.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const { id } = await context.params;
    const input = editTransformerSchema.parse(await request.json().catch(() => null));

    const before = await prisma.transformer.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Transformer not found." }, { status: 404 });

    const data = {
      ratingKva: input.ratingKva,
      primaryKv: input.primaryKv,
      secondaryKv: input.secondaryKv,
      phases: input.phases,
      coolingType: input.coolingType,
      impedancePct: input.impedancePct ?? null,
      vectorGroup: input.vectorGroup || null,
      oilVolumeLitres: input.oilVolumeLitres ?? null,
      yearOfManufacture: input.yearOfManufacture,
      frequencyHz: input.frequencyHz ?? null,
      duty: input.duty || null,
      standardRef: input.standardRef || null,
      hvInsulationLevelKv: input.hvInsulationLevelKv || null,
      tempRiseOilC: input.tempRiseOilC ?? null,
      tempRiseWindingC: input.tempRiseWindingC ?? null,
      tempClass: input.tempClass || null,
      maxAmbientTempC: input.maxAmbientTempC ?? null,
      insulationOilType: input.insulationOilType || null,
      oilWeightKg: input.oilWeightKg ?? null,
      totalWeightKg: input.totalWeightKg ?? null,
      tapRange: input.tapRange || null,

      lossRatioR: input.lossRatioR ?? null,
      topOilRiseK: input.topOilRiseK ?? null,
      hotSpotGradientK: input.hotSpotGradientK ?? null,
      windingExponentX: input.windingExponentX ?? null,
      oilExponentY: input.oilExponentY ?? null,
    };

    // Summarise which fields actually changed, for the audit line.
    const LABELS: Record<string, string> = {
      ratingKva: "rating", primaryKv: "primary kV", secondaryKv: "secondary kV",
      vectorGroup: "vector group", impedancePct: "impedance", frequencyHz: "frequency",
      standardRef: "standard", hvInsulationLevelKv: "BIL", tempClass: "temp class",
      insulationOilType: "oil type", oilWeightKg: "oil weight", totalWeightKg: "total weight",
      // Named in full on the audit line. Changing a thermal constant changes
      // every hot-spot this transformer will ever report, so "edited nameplate"
      // would not be an honest description of what happened.
      lossRatioR: "loss ratio R", topOilRiseK: "top-oil rise", hotSpotGradientK: "hot-spot gradient",
      windingExponentX: "oil exponent x", oilExponentY: "winding exponent y",
    };
    const changed = Object.keys(LABELS)
      .filter((k) => String((before as Record<string, unknown>)[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? ""))
      .map((k) => LABELS[k]);

    await prisma.$transaction(async (tx) => {
      await tx.transformer.update({ where: { id }, data });
      await writeAudit(
        {
          actorId: actor.id,
          action: "EDIT",
          targetType: "Transformer",
          targetId: id,
          targetLabel: before.gNumber ?? before.serialNumber,
          details: changed.length ? `Nameplate updated: ${changed.join(", ")}` : "Nameplate saved (no values changed)",
        },
        tx,
      );
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
