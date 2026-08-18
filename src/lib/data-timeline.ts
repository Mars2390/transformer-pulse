import "server-only";
import { prisma } from "@/lib/prisma";
import { ratedPhaseCurrent } from "@/lib/load-analysis";

/**
 * Everything that has ever been recorded about one transformer, on one axis.
 *
 * WHAT ACTUALLY LINKS THE DATA
 *
 * The brief calls the G-Number the primary key. It cannot be, and building on
 * that assumption would break the system precisely where it matters most.
 *
 * Transformer.gNumber is nullable and unique. The null is deliberate — it is
 * the gap where paper loses transformers today, a unit that has arrived but
 * has not been booked in. KPLC's own inspection register carries G-Numbers
 * reading "Defaced" and "Faded numbers", and the EMDis export carries NO
 * G-Number at all: it names a substation and a serial, which is why
 * EmdisDataset resolves through substationCode and records how it matched.
 *
 * So the join key is Transformer.id, with gNumber as the human identifier
 * printed on everything. Keyed on the G-Number, every unit with an unreadable
 * plate — the oldest and most failure-prone in the fleet — would silently drop
 * out of its own history.
 *
 * Everything below therefore takes a transformer id and reads each source by
 * its own foreign key, which is what makes the timeline complete.
 */

export type TimelineKind =
  | "EMDIS_UPLOAD"
  | "INSPECTION"
  | "TEST"
  | "MOVEMENT"
  | "REPAIR"
  | "EVENT";

export type TimelineEntry = {
  id: string;
  kind: TimelineKind;
  /** ISO. The date the thing HAPPENED, not the date it was typed in. */
  occurredAt: string;
  title: string;
  summary: string;
  /** Expanded detail: label/value pairs, rendered as a definition list. */
  detail: [string, string][];
  /** Where the reader can go for the full record, when one exists. */
  href: string | null;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number) => `${n.toFixed(0)}%`;

/**
 * Peak phase loading for one EMDis dataset, as a percentage of rated current.
 *
 * Driven by the WORST phase, not by the kVA figure. A transformer can sit at
 * 71% of nameplate while one phase runs at 121% — that is a real reading from
 * substation 14537 — and the kVA number hides exactly the condition that
 * destroys windings.
 */
function peakPhasePct(
  hourly: { maxL1c: number | null; maxL2c: number | null; maxL3c: number | null }[],
  ratingKva: number,
  voltLL: number,
): { pct: number; phase: "L1" | "L2" | "L3" } | null {
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  if (!(iRated > 0)) return null;

  let best: { pct: number; phase: "L1" | "L2" | "L3" } | null = null;
  for (const h of hourly) {
    const candidates: [("L1" | "L2" | "L3"), number | null][] = [
      ["L1", h.maxL1c],
      ["L2", h.maxL2c],
      ["L3", h.maxL3c],
    ];
    for (const [phase, amps] of candidates) {
      if (amps == null) continue;
      const value = (amps / iRated) * 100;
      if (!best || value > best.pct) best = { pct: value, phase };
    }
  }
  return best;
}

export type EmdisPeriod = {
  datasetId: string;
  name: string;
  firstReadingAt: string;
  lastReadingAt: string;
  readingCount: number;
  /** Null when the dataset has hourly rows but no phase currents. */
  peakPhasePct: number | null;
  peakPhase: "L1" | "L2" | "L3" | null;
  avgKva: number | null;
  maxKva: number | null;
  minVoltage: number | null;
  resolvedBy: string;
};

export type TrendDirection = "IMPROVING" | "WORSENING" | "STABLE" | "UNKNOWN";

export type EmdisTrend = {
  periods: EmdisPeriod[];
  direction: TrendDirection;
  /** "121% → 108% → 95%" */
  series: string;
  /** Percentage points between the first and last period. */
  changePoints: number | null;
  latestPct: number | null;
  latestPhase: string | null;
  verdict: string;
  nextAction: string;
};

/**
 * A change of this many percentage points or less is noise, not a trend.
 *
 * EMDis periods are different weeks with different weather and different load,
 * so two readings four points apart say nothing. Calling that "improving"
 * teaches people to disbelieve the label, which costs more than having no
 * label at all.
 */
const TREND_NOISE_POINTS = 5;

export async function buildEmdisTrend(transformerId: string, ratingKva: number): Promise<EmdisTrend> {
  const datasets = await prisma.emdisDataset.findMany({
    where: { transformerId },
    orderBy: { firstReadingAt: "asc" },
    select: {
      id: true,
      name: true,
      firstReadingAt: true,
      lastReadingAt: true,
      readingCount: true,
      nominalVoltLL: true,
      resolvedBy: true,
      hourly: {
        select: {
          maxL1c: true, maxL2c: true, maxL3c: true,
          avgKva: true, maxKva: true, minVoltage: true,
        },
      },
    },
  });

  const periods: EmdisPeriod[] = datasets.map((d) => {
    const peak = peakPhasePct(d.hourly, ratingKva, d.nominalVoltLL);
    const kvas = d.hourly.map((h) => h.avgKva).filter((v): v is number => v != null);
    const maxKvas = d.hourly.map((h) => h.maxKva).filter((v): v is number => v != null);
    const volts = d.hourly.map((h) => h.minVoltage).filter((v): v is number => v != null);
    return {
      datasetId: d.id,
      name: d.name,
      firstReadingAt: iso(d.firstReadingAt),
      lastReadingAt: iso(d.lastReadingAt),
      readingCount: d.readingCount,
      peakPhasePct: peak ? Math.round(peak.pct) : null,
      peakPhase: peak?.phase ?? null,
      avgKva: kvas.length ? kvas.reduce((a, b) => a + b, 0) / kvas.length : null,
      maxKva: maxKvas.length ? Math.max(...maxKvas) : null,
      minVoltage: volts.length ? Math.min(...volts) : null,
      resolvedBy: d.resolvedBy,
    };
  });

  const measured = periods.filter((p) => p.peakPhasePct != null);
  const series = measured.map((p) => pct(p.peakPhasePct!)).join(" → ");
  const latest = measured.at(-1) ?? null;
  const first = measured[0] ?? null;

  let direction: TrendDirection = "UNKNOWN";
  let changePoints: number | null = null;

  if (measured.length >= 2 && first && latest) {
    changePoints = latest.peakPhasePct! - first.peakPhasePct!;
    direction =
      Math.abs(changePoints) <= TREND_NOISE_POINTS
        ? "STABLE"
        : changePoints < 0
          ? "IMPROVING"
          : "WORSENING";
  } else if (measured.length === 1) {
    direction = "UNKNOWN";
  }

  const latestPct = latest?.peakPhasePct ?? null;
  const overloaded = latestPct != null && latestPct >= 100;
  const heavy = latestPct != null && latestPct >= 80;

  const verdict =
    latestPct == null
      ? measured.length === 0 && periods.length > 0
        ? "Load data is present but carries no phase currents, so loading cannot be assessed."
        : "No load telemetry has been uploaded for this transformer."
      : overloaded
        ? `Phase ${latest!.peakPhase} at ${pct(latestPct)} of rated — OVERLOADED.`
        : heavy
          ? `Phase ${latest!.peakPhase} at ${pct(latestPct)} of rated — heavily loaded.`
          : `Phase ${latest!.peakPhase} at ${pct(latestPct)} of rated — normal.`;

  const nextAction =
    latestPct == null
      ? "Upload an EMDis export for this substation to establish a baseline."
      : overloaded
        ? "Transfer load or upgrade the rating. A phase above rated is destroying insulation now, whatever the kVA figure says."
        : direction === "WORSENING"
          ? `Loading has risen ${Math.abs(changePoints ?? 0)} points across the periods on record. Plan a load transfer before it reaches rated.`
          : heavy
            ? "Watch it. Another period at this level warrants a load transfer."
            : direction === "IMPROVING"
              ? "No action. Confirm the improvement holds in the next period."
              : "Monitor next month.";

  return { periods, direction, series, changePoints, latestPct, latestPhase: latest?.peakPhase ?? null, verdict, nextAction };
}

export type InspectionPoint = {
  id: string;
  inspectedOn: string;
  inspectorRef: string;
  structure: string | null;
  loadingOk: boolean | null;
  loadAction: string | null;
  openEarth: boolean;
  fuseCarriers: string | null;
  needsReview: boolean;
};

export type InspectionTrend = {
  points: InspectionPoint[];
  /** Plain-language changes between consecutive visits, newest first. */
  changes: string[];
  direction: TrendDirection;
};

const STRUCTURE_RANK: Record<string, number> = { OKAY: 0, LEANING: 1, ROTTEN: 2 };

export async function buildInspectionTrend(transformerId: string): Promise<InspectionTrend> {
  const rows = await prisma.substationInspection.findMany({
    where: { transformerId },
    orderBy: { inspectedOn: "asc" },
    select: {
      id: true, inspectedOn: true, inspectorRef: true, structure: true,
      loadingOk: true, loadAction: true, hvEarthState: true, neutralEarthState: true,
      fuseCarriers: true, needsReview: true,
    },
  });

  const points: InspectionPoint[] = rows.map((r) => ({
    id: r.id,
    inspectedOn: day(r.inspectedOn),
    inspectorRef: r.inspectorRef,
    structure: r.structure,
    loadingOk: r.loadingOk,
    loadAction: r.loadAction,
    openEarth: r.hvEarthState === "OPEN_CIRCUIT" || r.neutralEarthState === "OPEN_CIRCUIT",
    fuseCarriers: r.fuseCarriers,
    needsReview: r.needsReview,
  }));

  // Consecutive visits, compared. This is the whole reason inspections are
  // append-only: the disagreement between two visits IS the finding, and a
  // register that overwrote the previous answer could never produce this.
  const changes: string[] = [];
  let structureDelta = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const now = points[i];
    const when = `${prev.inspectedOn} → ${now.inspectedOn}`;

    if (prev.structure !== now.structure && (prev.structure || now.structure)) {
      const before = prev.structure ?? "not recorded";
      const after = now.structure ?? "not recorded";
      const worse = (STRUCTURE_RANK[after] ?? 0) > (STRUCTURE_RANK[before] ?? 0);
      structureDelta += worse ? 1 : -1;
      changes.push(`${when}: pole went from ${before} to ${after}.`);
    }
    if (prev.openEarth !== now.openEarth) {
      changes.push(
        now.openEarth
          ? `${when}: earth reading became OL — over range, meaning no effective earth.`
          : `${when}: earthing was restored.`,
      );
    }
    if (prev.loadingOk !== now.loadingOk && now.loadingOk === false) {
      changes.push(`${when}: inspector judged the unit overloaded${now.loadAction ? ` and recorded ${now.loadAction}` : ""}.`);
    }
    if (prev.fuseCarriers !== now.fuseCarriers && now.fuseCarriers) {
      changes.push(`${when}: fuse carriers recorded as ${now.fuseCarriers}.`);
    }
  }

  const direction: TrendDirection =
    points.length < 2 ? "UNKNOWN" : structureDelta > 0 ? "WORSENING" : structureDelta < 0 ? "IMPROVING" : "STABLE";

  return { points, changes: changes.reverse(), direction };
}

export async function buildDataTimeline(transformerId: string): Promise<TimelineEntry[]> {
  const [datasets, inspections, tests, movements, repairs] = await Promise.all([
    prisma.emdisDataset.findMany({
      where: { transformerId },
      orderBy: { firstReadingAt: "desc" },
      select: {
        id: true, name: true, firstReadingAt: true, lastReadingAt: true,
        readingCount: true, uploadedByName: true, resolvedBy: true,
        substationCode: true, createdAt: true, _count: { select: { hourly: true } },
      },
    }),
    prisma.substationInspection.findMany({
      where: { transformerId },
      orderBy: { inspectedOn: "desc" },
      select: {
        id: true, reportId: true, inspectedOn: true, inspectorRef: true, structure: true,
        loadingOk: true, loadAction: true, hvEarthOhm: true, hvEarthState: true,
        fuseCarriers: true, locationNote: true, needsReview: true, reviewReasons: true,
        sourceFile: true,
      },
    }),
    prisma.testRecord.findMany({
      where: { transformerId },
      orderBy: { testedAt: "desc" },
      select: {
        id: true, stage: true, passed: true, testedAt: true, oilBdvKv: true,
        insulationResistanceHvMohm: true, insulationResistanceLvMohm: true,
        turnsRatioDeviationPct: true, remarks: true, testedBy: { select: { name: true } },
      },
    }),
    prisma.transactionRecord.findMany({
      where: { transformerId },
      orderBy: { initiatedAt: "desc" },
      select: {
        id: true, movement: true, fromName: true, toName: true, status: true,
        initiatedAt: true, approvedAt: true, departedAt: true, arrivedAt: true,
        vehiclePlate: true, driverName: true, batchRef: true,
      },
    }),
    prisma.repairRecord.findMany({
      where: { transformerId },
      orderBy: { receivedAtWorkshop: "desc" },
      select: {
        id: true, receivedAtWorkshop: true, repairCompletedAt: true, status: true,
        faultCauseReported: true, faultCauseConfirmed: true, repairActions: true,
        partsReplaced: true, repairCostKes: true, repairSuccessful: true,
        workshopName: true, technician: { select: { name: true } },
      },
    }),
  ]);

  const entries: TimelineEntry[] = [];

  for (const d of datasets) {
    entries.push({
      id: `emdis-${d.id}`,
      kind: "EMDIS_UPLOAD",
      occurredAt: iso(d.firstReadingAt),
      title: `EMDis load data — ${d.name}`,
      summary: `${d.readingCount.toLocaleString()} readings, ${day(d.firstReadingAt)} to ${day(d.lastReadingAt)}.`,
      detail: [
        ["Period", `${day(d.firstReadingAt)} → ${day(d.lastReadingAt)}`],
        ["Readings", d.readingCount.toLocaleString()],
        ["Hourly buckets", String(d._count.hourly)],
        ["Substation on file", d.substationCode ?? "not stated"],
        ["Matched to this unit by", d.resolvedBy],
        ["Uploaded by", d.uploadedByName],
        ["Uploaded on", day(d.createdAt)],
      ],
      href: `/manager/load-analysis/${d.id}`,
      tone: "info",
    });
  }

  for (const i of inspections) {
    const defects = [
      i.structure === "ROTTEN" || i.structure === "LEANING" ? `pole ${i.structure}` : null,
      i.hvEarthState === "OPEN_CIRCUIT" ? "no effective earth" : null,
      i.loadingOk === false ? "judged overloaded" : null,
      i.fuseCarriers && i.fuseCarriers !== "OKAY" ? `fuse carriers ${i.fuseCarriers}` : null,
    ].filter(Boolean);

    entries.push({
      id: `inspection-${i.id}`,
      kind: "INSPECTION",
      occurredAt: iso(i.inspectedOn),
      title: `KYN inspection — report #${i.reportId}`,
      summary: defects.length ? `Found: ${defects.join(", ")}.` : "No defects recorded.",
      detail: [
        ["Inspector", i.inspectorRef],
        ["Structure", i.structure ?? "not recorded"],
        ["HV earth", i.hvEarthState === "OPEN_CIRCUIT" ? "OL — over range, no effective earth" : i.hvEarthOhm != null ? `${i.hvEarthOhm} Ω` : "not measured"],
        ["Loading judgement", i.loadingOk === false ? `overloaded${i.loadAction ? ` — ${i.loadAction}` : ""}` : i.loadingOk === true ? "acceptable" : "not recorded"],
        ["Fuse carriers", i.fuseCarriers ?? "not recorded"],
        ["Location note", i.locationNote ?? "—"],
        ["Source file", i.sourceFile],
        ...(i.needsReview ? ([["Needs review", i.reviewReasons.join("; ")]] as [string, string][]) : []),
      ],
      href: "/manager/inspections",
      tone: defects.length ? "warning" : "success",
    });
  }

  for (const t of tests) {
    entries.push({
      id: `test-${t.id}`,
      kind: "TEST",
      occurredAt: iso(t.testedAt),
      title: `${t.stage.replace(/_/g, " ").toLowerCase()} test`,
      summary: t.passed ? "Passed." : "FAILED.",
      detail: [
        ["Stage", t.stage],
        ["Result", t.passed ? "Pass" : "Fail"],
        ["Oil BDV", t.oilBdvKv != null ? `${t.oilBdvKv} kV` : "not measured"],
        ["IR HV–earth", t.insulationResistanceHvMohm != null ? `${t.insulationResistanceHvMohm} MΩ` : "not measured"],
        ["IR LV–earth", t.insulationResistanceLvMohm != null ? `${t.insulationResistanceLvMohm} MΩ` : "not measured"],
        ["Turns ratio deviation", t.turnsRatioDeviationPct != null ? `${t.turnsRatioDeviationPct}%` : "not measured"],
        ["Tested by", t.testedBy.name],
        ["Remarks", t.remarks ?? "—"],
      ],
      href: null,
      tone: t.passed ? "success" : "danger",
    });
  }

  for (const m of movements) {
    entries.push({
      id: `movement-${m.id}`,
      kind: "MOVEMENT",
      occurredAt: iso(m.initiatedAt),
      title: `${m.fromName} → ${m.toName}`,
      summary: `${m.movement.replace(/_/g, " ").toLowerCase()} · ${m.status.replace(/_/g, " ").toLowerCase()}.`,
      detail: [
        ["Movement", m.movement],
        ["Status", m.status],
        ["Raised", day(m.initiatedAt)],
        ["Approved", m.approvedAt ? day(m.approvedAt) : "not yet"],
        ["Departed", m.departedAt ? day(m.departedAt) : "not yet"],
        ["Arrived", m.arrivedAt ? day(m.arrivedAt) : "not yet"],
        ["Vehicle", m.vehiclePlate ?? "—"],
        ["Driver", m.driverName ?? "—"],
        ["Batch", m.batchRef ?? "—"],
      ],
      href: `/transactions/${m.id}`,
      tone: m.status === "COMPLETED" ? "success" : m.status === "REJECTED" ? "danger" : "info",
    });
  }

  for (const r of repairs) {
    entries.push({
      id: `repair-${r.id}`,
      kind: "REPAIR",
      occurredAt: iso(r.receivedAtWorkshop),
      title: `Workshop visit — ${r.workshopName ?? "workshop"}`,
      summary:
        r.repairSuccessful === true
          ? `Repaired. Confirmed cause: ${r.faultCauseConfirmed ?? "not stated"}.`
          : r.repairSuccessful === false
            ? `Condemned. ${r.faultCauseConfirmed ?? ""}`.trim()
            : `On the bench — ${r.status.replace(/_/g, " ").toLowerCase()}.`,
      detail: [
        ["Received", day(r.receivedAtWorkshop)],
        ["Completed", r.repairCompletedAt ? day(r.repairCompletedAt) : "still open"],
        ["Bench status", r.status],
        ["Technician", r.technician?.name ?? "not assigned"],
        ["Fault reported", r.faultCauseReported ?? "not stated"],
        ["Fault CONFIRMED at workshop", r.faultCauseConfirmed ?? "not yet established"],
        ["Work done", r.repairActions ?? "—"],
        ["Parts replaced", r.partsReplaced ?? "—"],
        ["Cost", r.repairCostKes != null ? `KES ${Math.round(r.repairCostKes).toLocaleString()}` : "—"],
      ],
      href: null,
      tone: r.repairSuccessful === false ? "danger" : r.repairSuccessful ? "success" : "warning",
    });
  }

  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export type SmartSummary = {
  emdisCount: number;
  emdisMonths: string[];
  inspectionCount: number;
  inspectionMonths: string[];
  repairCount: number;
  repairMonths: string[];
  trend: EmdisTrend;
  inspectionTrend: InspectionTrend;
};

const MONTH = (isoDate: string) =>
  new Date(isoDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export async function buildSmartSummary(transformerId: string, ratingKva: number): Promise<SmartSummary> {
  const [trend, inspectionTrend, repairs] = await Promise.all([
    buildEmdisTrend(transformerId, ratingKva),
    buildInspectionTrend(transformerId),
    prisma.repairRecord.findMany({
      where: { transformerId },
      orderBy: { receivedAtWorkshop: "asc" },
      select: { receivedAtWorkshop: true },
    }),
  ]);

  return {
    emdisCount: trend.periods.length,
    emdisMonths: trend.periods.map((p) => MONTH(p.firstReadingAt)),
    inspectionCount: inspectionTrend.points.length,
    inspectionMonths: inspectionTrend.points.map((p) => MONTH(p.inspectedOn)),
    repairCount: repairs.length,
    repairMonths: repairs.map((r) => MONTH(iso(r.receivedAtWorkshop))),
    trend,
    inspectionTrend,
  };
}
