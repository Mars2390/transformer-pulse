import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { ratedPhaseCurrent, LIMITS } from "@/lib/load-analysis";
import { computeThermal } from "@/lib/transformer-thermal";
import { ASSUMED_AMBIENT_C } from "@/lib/emdis-read";

/**
 * The control room's data feed.
 *
 * GET (no cursor)   the dataset's identity, rating and total length
 * GET ?cursor=N     one reading, fully analysed, plus a trailing window
 *
 * The room replays real recorded minutes rather than inventing a live stream.
 * That distinction matters when an engineer asks what they are looking at: this
 * is KPLC's own telemetry played back at a chosen speed, with every figure
 * computed by the same engine the reports use.
 */
export async function GET(request: Request) {
  try {
    await requireApiRole("ADMIN", "MANAGER");
    const url = new URL(request.url);
    const datasetId = url.searchParams.get("dataset");
    const cursor = url.searchParams.get("cursor");

    const dataset = datasetId
      ? await prisma.emdisDataset.findUnique({
          where: { id: datasetId },
          include: {
            transformer: {
              include: {
                manufacturer: { select: { name: true } },
                inspections: { orderBy: { inspectedOn: "desc" }, take: 1 },
              },
            },
          },
        })
      : await prisma.emdisDataset.findFirst({
          orderBy: { createdAt: "desc" },
          include: {
            transformer: {
              include: {
                manufacturer: { select: { name: true } },
                inspections: { orderBy: { inspectedOn: "desc" }, take: 1 },
              },
            },
          },
        });

    if (!dataset) return NextResponse.json({ dataset: null });

    const ratingKva = dataset.transformer?.ratingKva ?? dataset.ratingKvaAsRecorded ?? 200;
    const iRated = ratedPhaseCurrent(ratingKva, dataset.nominalVoltLL);
    const insp = dataset.transformer?.inspections?.[0] ?? null;

    if (cursor == null) {
      return NextResponse.json({
        dataset: {
          id: dataset.id,
          name: dataset.name,
          substationCode: dataset.substationCode,
          substationName: dataset.transformer?.substationName ?? null,
          gNumber: dataset.transformer?.gNumber ?? null,
          transformerId: dataset.transformer?.id ?? null,
          make: dataset.transformer?.manufacturer.name ?? dataset.makeAsRecorded,
          ratingKva,
          ratedPhaseA: iRated,
          voltLL: dataset.nominalVoltLL,
          readingCount: dataset.readingCount,
          intervalSeconds: dataset.intervalSeconds,
          firstReadingAt: dataset.firstReadingAt,
          lastReadingAt: dataset.lastReadingAt,
          siteName: dataset.transformer?.currentSiteName ?? insp?.locationNote ?? null,
          fuseSizeA: insp?.fuseSizeA ?? null,
          inspection: insp
            ? {
                inspectedOn: insp.inspectedOn,
                inspectorRef: insp.inspectorRef,
                loadingOk: insp.loadingOk,
                loadAction: insp.loadAction,
                structure: insp.structure,
              }
            : null,
        },
        limits: {
          phaseWarn: LIMITS.phaseWarn * 100,
          phaseCritical: LIMITS.phaseCritical * 100,
          unbalanceWarn: LIMITS.unbalanceWarn,
          unbalanceCritical: LIMITS.unbalanceCritical,
          neutralWarn: LIMITS.neutralWarn * 100,
          neutralCritical: LIMITS.neutralCritical * 100,
          thdWarn: LIMITS.thdWarn,
          thdCritical: LIMITS.thdCritical,
          hotspotC: LIMITS.hotspotC,
          topOilC: LIMITS.topOilC,
        },
      });
    }

    const at = Math.max(0, Number(cursor) || 0);
    const WINDOW = 90;

    const rows = await prisma.emdisReading.findMany({
      where: { datasetId: dataset.id },
      orderBy: { recordedAt: "asc" },
      skip: Math.max(0, at - WINDOW + 1),
      take: Math.min(WINDOW, at + 1),
    });
    if (!rows.length) return NextResponse.json({ end: true });

    const now = rows[rows.length - 1];
    const pf = now.pf && now.pf > 0.1 ? now.pf : 0.95;

    // The hot-spot is in the winding carrying the most current, so the thermal
    // model is driven by peak phase, not by the kVA reading.
    const phasePu = (now.maxPhaseC ?? 0) / iRated;
    const thermal = computeThermal({
      loadKva: phasePu * ratingKva,
      ratingKva,
      ambientC: ASSUMED_AMBIENT_C,
      powerFactor: pf,
    });

    const flags: { code: string; severity: "WARNING" | "CRITICAL"; text: string }[] = [];
    const pct = now.maxPhasePctRated ?? 0;
    if (pct >= 100) flags.push({ code: "PHASE", severity: "CRITICAL", text: `Phase at ${pct.toFixed(0)}% of rated current` });
    else if (pct >= 80) flags.push({ code: "PHASE", severity: "WARNING", text: `Phase at ${pct.toFixed(0)}% of rated` });

    const unb = now.phaseUnbalancePct ?? 0;
    if (unb >= LIMITS.unbalanceCritical) flags.push({ code: "UNBALANCE", severity: "CRITICAL", text: `Unbalance ${unb.toFixed(0)}%` });
    else if (unb >= LIMITS.unbalanceWarn) flags.push({ code: "UNBALANCE", severity: "WARNING", text: `Unbalance ${unb.toFixed(0)}%` });

    const nPct = now.neutralPctRated ?? 0;
    if (nPct >= LIMITS.neutralCritical * 100) flags.push({ code: "NEUTRAL", severity: "CRITICAL", text: `Neutral at ${nPct.toFixed(0)}% of rated` });
    else if (nPct >= LIMITS.neutralWarn * 100) flags.push({ code: "NEUTRAL", severity: "WARNING", text: `Neutral at ${nPct.toFixed(0)}% of rated` });

    if ((now.thdPct ?? 0) > LIMITS.thdCritical) flags.push({ code: "THD", severity: "WARNING", text: `THD ${now.thdPct!.toFixed(1)}%` });

    const volts = [now.l1nV, now.l2nV, now.l3nV].filter((v): v is number => v != null && v > 50);
    const avgV = volts.length ? volts.reduce((s, v) => s + v, 0) / volts.length : null;
    if (avgV != null && Math.abs((avgV - 240) / 240) * 100 > LIMITS.voltageTolerancePct) {
      flags.push({
        code: "VOLTAGE",
        severity: avgV < 240 * 0.9 ? "CRITICAL" : "WARNING",
        text: `Supply ${avgV.toFixed(0)} V, outside 240 V ±${LIMITS.voltageTolerancePct}%`,
      });
    }

    if (insp?.fuseSizeA && (now.maxPhaseC ?? 0) > insp.fuseSizeA) {
      flags.push({ code: "FUSE", severity: "CRITICAL", text: `Above the ${insp.fuseSizeA} A fuse` });
    }

    if (thermal.hotspotC > LIMITS.hotspotC) {
      flags.push({ code: "HOTSPOT", severity: "CRITICAL", text: `Hot-spot ${thermal.hotspotC.toFixed(0)} °C` });
    }

    return NextResponse.json({
      cursor: at,
      end: at >= dataset.readingCount - 1,
      now: {
        recordedAt: now.recordedAt,
        l1c: now.l1c, l2c: now.l2c, l3c: now.l3c, neutralC: now.neutralC,
        l1nV: now.l1nV, l2nV: now.l2nV, l3nV: now.l3nV,
        kva: now.kva, kw: now.kw, kvar: now.kvar, pf: now.pf, hz: now.hz, thdPct: now.thdPct,
        maxPhaseC: now.maxPhaseC,
        maxPhasePctRated: now.maxPhasePctRated,
        loadingPct: now.loadingPct,
        unbalancePct: now.phaseUnbalancePct,
        neutralPctRated: now.neutralPctRated,
        avgVoltage: avgV,
      },
      thermal: {
        hotspotC: thermal.hotspotC,
        topOilC: thermal.topOilC,
        ageingRate: thermal.ageingRate,
        band: thermal.band,
        totalLossesW: thermal.totalLossesW,
        efficiencyPct: thermal.efficiencyPct,
      },
      flags,
      window: rows.map((r) => ({
        t: r.recordedAt,
        kva: r.kva ?? 0,
        maxPct: r.maxPhasePctRated ?? 0,
        unb: r.phaseUnbalancePct ?? 0,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
