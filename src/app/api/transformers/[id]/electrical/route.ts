import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { correctIrTo20C, wrDeviationPct, IR_LIMITS } from "@/lib/insulation";

/**
 * POST /api/transformers/[id]/electrical — record an insulation and winding
 * resistance test taken at the pole.
 *
 * Winding temperature is mandatory and that is not bureaucracy. Insulation
 * resistance roughly halves for every 10 °C rise, so the same healthy winding
 * reads four times lower at 45 °C than at 25 °C. Without the temperature there
 * is nothing to compare a reading against, including its own history.
 */

const schema = z.object({
  irHvEarthMohm: z.coerce.number().min(0).max(1_000_000).optional(),
  irLvEarthMohm: z.coerce.number().min(0).max(1_000_000).optional(),
  irHvLvMohm: z.coerce.number().min(0).max(1_000_000).optional(),

  irTestVoltageV: z.coerce.number().refine((v) => [500, 1000, 2500, 5000].includes(v), "Choose a standard test voltage."),
  irDurationSec: z.coerce.number().refine((v) => [60, 600].includes(v), "Choose 60 s or 10 min."),
  irOneMinuteMohm: z.coerce.number().min(0).optional(),
  irTenMinuteMohm: z.coerce.number().min(0).optional(),

  windingTempC: z.coerce.number().min(-10).max(150),
  ambientTempC: z.coerce.number().min(-10).max(60).optional(),

  wrHvOhm: z.coerce.number().min(0).optional(),
  wrLvOhm: z.coerce.number().min(0).optional(),
  wrHvL1: z.coerce.number().min(0).optional(),
  wrHvL2: z.coerce.number().min(0).optional(),
  wrHvL3: z.coerce.number().min(0).optional(),
  wrLvL1: z.coerce.number().min(0).optional(),
  wrLvL2: z.coerce.number().min(0).optional(),
  wrLvL3: z.coerce.number().min(0).optional(),

  photoUrls: z.array(z.string().url()).max(5).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiRole("FIELD_ENGINEER", "STORE_KEEPER", "ADMIN");
    const { id } = await context.params;
    const input = schema.parse(await request.json().catch(() => null));

    const tx = await prisma.transformer.findUnique({
      where: { id },
      select: { id: true, gNumber: true, serialNumber: true, region: true },
    });
    if (!tx) return NextResponse.json({ error: "Transformer not found." }, { status: 404 });

    const label = tx.gNumber ?? tx.serialNumber;

    // --- Derived values ----------------------------------------------------
    const lowestIr = [input.irHvEarthMohm, input.irLvEarthMohm, input.irHvLvMohm]
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)[0];

    const irCorrectedTo20C = lowestIr != null ? correctIrTo20C(lowestIr, input.windingTempC) : null;

    const polarizationIndex =
      input.irOneMinuteMohm && input.irTenMinuteMohm && input.irOneMinuteMohm > 0
        ? input.irTenMinuteMohm / input.irOneMinuteMohm
        : null;

    const hvDeviation = wrDeviationPct([input.wrHvL1, input.wrHvL2, input.wrHvL3]);
    const lvDeviation = wrDeviationPct([input.wrLvL1, input.wrLvL2, input.wrLvL3]);
    const worstDeviation = [hvDeviation, lvDeviation].filter((v): v is number => v != null).sort((a, b) => b - a)[0] ?? null;

    // --- Verdict -----------------------------------------------------------
    const findings: string[] = [];
    let passed = true;

    if (irCorrectedTo20C != null) {
      if (irCorrectedTo20C < IR_LIMITS.hardFloorMohm) {
        passed = false;
        findings.push(`Insulation resistance ${irCorrectedTo20C.toFixed(2)} MΩ corrected to 20 °C — below 1 MΩ. Do not energise.`);
      } else if (irCorrectedTo20C < IR_LIMITS.criticalMohm) {
        passed = false;
        findings.push(`Insulation resistance ${irCorrectedTo20C.toFixed(0)} MΩ at 20 °C — below the ${IR_LIMITS.criticalMohm} MΩ action level.`);
      } else if (irCorrectedTo20C < IR_LIMITS.warnMohm) {
        findings.push(`Insulation resistance ${irCorrectedTo20C.toFixed(0)} MΩ at 20 °C — below the ${IR_LIMITS.warnMohm} MΩ watch level.`);
      }
    }

    if (polarizationIndex != null && polarizationIndex < IR_LIMITS.piCritical) {
      passed = false;
      findings.push(`Polarization index ${polarizationIndex.toFixed(2)} — under 1.0 means the insulation is absorbing moisture.`);
    } else if (polarizationIndex != null && polarizationIndex < IR_LIMITS.piWarn) {
      findings.push(`Polarization index ${polarizationIndex.toFixed(2)} — questionable, repeat after drying.`);
    }

    if (worstDeviation != null && worstDeviation > IR_LIMITS.wrDeviationCriticalPct) {
      passed = false;
      findings.push(`Winding resistance differs ${worstDeviation.toFixed(1)}% between phases — suspect a loose connection or a damaged winding.`);
    } else if (worstDeviation != null && worstDeviation > IR_LIMITS.wrDeviationWarnPct) {
      findings.push(`Winding resistance differs ${worstDeviation.toFixed(1)}% between phases.`);
    }

    const remarks = [
      input.remarks,
      `Test voltage ${input.irTestVoltageV} V for ${input.irDurationSec >= 600 ? "10 min" : "60 s"} at ${input.windingTempC} °C winding.`,
      irCorrectedTo20C != null ? `Lowest IR ${lowestIr!.toFixed(1)} MΩ measured, ${irCorrectedTo20C.toFixed(1)} MΩ corrected to 20 °C.` : null,
      polarizationIndex != null ? `Polarization index ${polarizationIndex.toFixed(2)}.` : null,
      worstDeviation != null ? `Worst winding resistance spread ${worstDeviation.toFixed(1)}%.` : null,
      ...findings,
    ].filter(Boolean).join(" ");

    const record = await prisma.testRecord.create({
      data: {
        transformerId: id,
        stage: "FIELD_DIAGNOSTIC",
        testedById: actor.id,
        insulationResistanceHvMohm: input.irHvEarthMohm ?? null,
        insulationResistanceLvMohm: input.irLvEarthMohm ?? null,
        windingResistanceHvOhm: input.wrHvOhm ?? input.wrHvL1 ?? null,
        windingResistanceLvOhm: input.wrLvOhm ?? input.wrLvL1 ?? null,
        irTestVoltageV: input.irTestVoltageV,
        irDurationSec: input.irDurationSec,
        polarizationIndex,
        windingTempC: input.windingTempC,
        irCorrectedTo20C,
        ambientTempC: input.ambientTempC ?? null,
        passed,
        remarks,
      },
    });

    // --- Alerts ------------------------------------------------------------
    const alerts = [];
    if (irCorrectedTo20C != null && irCorrectedTo20C < IR_LIMITS.criticalMohm) {
      alerts.push({
        transformerId: id,
        type: "IR_LOW" as const,
        severity: irCorrectedTo20C < IR_LIMITS.hardFloorMohm ? ("CRITICAL" as const) : ("WARNING" as const),
        region: tx.region,
        message:
          `${label}: insulation resistance ${irCorrectedTo20C.toFixed(irCorrectedTo20C < 10 ? 2 : 0)} MΩ corrected to 20 °C` +
          (irCorrectedTo20C < IR_LIMITS.hardFloorMohm ? " — below 1 MΩ, do not energise." : "."),
      });
    }
    if (worstDeviation != null && worstDeviation > IR_LIMITS.wrDeviationCriticalPct) {
      alerts.push({
        transformerId: id,
        type: "WR_DEVIATION" as const,
        severity: "CRITICAL" as const,
        region: tx.region,
        message: `${label}: winding resistance differs ${worstDeviation.toFixed(1)}% between phases.`,
      });
    }
    if (alerts.length) await prisma.alert.createMany({ data: alerts });

    return NextResponse.json(
      {
        id: record.id,
        passed,
        irCorrectedTo20C,
        polarizationIndex,
        wrDeviationPct: worstDeviation,
        findings,
        alertsRaised: alerts.length,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
