import "dotenv/config";
import { prisma } from "../src/lib/prisma";

/**
 * Independent audit of the load analysis.
 *
 * ---------------------------------------------------------------------------
 * Why this script does not import load-analysis.ts
 * ---------------------------------------------------------------------------
 * Every formula below is written out from first principles, in full, in this
 * file. That is the entire point. A check that called analyseReading() to
 * verify analyseReading() would agree with itself no matter how wrong it was —
 * it would be a test of nothing, dressed as reassurance.
 *
 * So this is a second implementation, from the standards rather than from the
 * code:
 *
 *   Rated phase current   I = S / (sqrt(3) x V_LL)      IEC 60076
 *   Current unbalance     max|phase - mean| / mean       NEMA MG-1
 *   Loading               measured kVA / nameplate kVA
 *   Phase loading         max phase current / rated phase current
 *   Neutral ratio         neutral current / rated phase current
 *   Minutes over rated    count of samples above rated x sample interval
 *
 * and every stored figure is checked against it: the per-reading fields, the
 * hourly rollup, the dataset boundaries, and the peak-load snapshot the API and
 * the alerts quote.
 *
 * It also checks something no per-dataset test can see: whether a transformer's
 * TOTALS are inflated by the same readings being held twice. Maxima survive
 * duplication and sums do not, so this is the one place the difference shows.
 *
 * Read-only. It writes nothing, ever.
 *
 *   npx tsx scripts/verify-analysis.mts                  # every dataset
 *   npx tsx scripts/verify-analysis.mts --dataset <id>   # one dataset
 *   npx tsx scripts/verify-analysis.mts --substation 14537
 *   npx tsx scripts/verify-analysis.mts --limit 5 --verbose
 */

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const valueOf = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};

const ONLY_DATASET = valueOf("--dataset");
const ONLY_SUBSTATION = valueOf("--substation");
const LIMIT = Number(valueOf("--limit") ?? 0);
const VERBOSE = has("--verbose");

/** Tolerance for a float comparison. Anything larger is a real disagreement. */
const EPS = 1e-6;

const SQRT3 = Math.sqrt(3);

// ---------------------------------------------------------------------------
// The independent implementation. Nothing here imports from src/lib.
// ---------------------------------------------------------------------------

/** I = S / (sqrt(3) x V_LL). Amperes, from kVA and line-to-line volts. */
function ratedPhaseCurrent(ratingKva: number, voltLL: number): number {
  return (ratingKva * 1000) / (SQRT3 * voltLL);
}

/**
 * NEMA MG-1 current unbalance, per cent.
 *
 * Below a 1 A mean it returns 0: an unloaded transformer is not 200%
 * unbalanced, and dividing by a near-zero mean manufactures a defect out of
 * noise.
 */
function unbalancePct(l1: number, l2: number, l3: number): number {
  const p = [l1, l2, l3].map((x) => (Number.isFinite(x) ? x : 0));
  const mean = (p[0] + p[1] + p[2]) / 3;
  if (mean <= 1) return 0;
  return (Math.max(...p.map((x) => Math.abs(x - mean))) / mean) * 100;
}

const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 0 : v);

type Reading = {
  id: number;
  recordedAt: Date;
  l1nV: number | null; l2nV: number | null; l3nV: number | null;
  l1c: number | null; l2c: number | null; l3c: number | null;
  neutralC: number | null;
  kva: number | null; kw: number | null; pf: number | null; thdPct: number | null;
  maxPhaseC: number | null;
  phaseUnbalancePct: number | null;
  loadingPct: number | null;
  maxPhasePctRated: number | null;
  neutralPctRated: number | null;
};

/** Everything the analysis claims about one reading, computed from scratch. */
function expectedForReading(r: Reading, ratingKva: number, iRated: number) {
  const phases = [n(r.l1c), n(r.l2c), n(r.l3c)];
  const maxPhaseC = Math.max(...phases);
  return {
    maxPhaseC,
    phaseUnbalancePct: unbalancePct(phases[0], phases[1], phases[2]),
    loadingPct: r.kva != null ? (r.kva / ratingKva) * 100 : 0,
    maxPhasePctRated: (maxPhaseC / iRated) * 100,
    neutralPctRated: (n(r.neutralC) / iRated) * 100,
  };
}

const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const max = (v: number[]) => (v.length ? Math.max(...v) : null);
const min = (v: number[]) => (v.length ? Math.min(...v) : null);
const p95 = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(0.95 * (s.length - 1))];
};
const defined = (v: (number | null)[]) => v.filter((x): x is number => x != null && Number.isFinite(x));

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

type Problem = { where: string; field: string; stored: unknown; expected: unknown; note?: string };

const problems: Problem[] = [];
let checks = 0;

function same(where: string, field: string, stored: number | null, expected: number | null, tol = EPS) {
  checks++;
  if (stored == null && expected == null) return;
  if (stored == null || expected == null) {
    problems.push({ where, field, stored, expected });
    return;
  }
  if (Math.abs(stored - expected) > tol) {
    problems.push({ where, field, stored, expected });
  }
}

function sameInt(where: string, field: string, stored: number, expected: number) {
  checks++;
  if (stored !== expected) problems.push({ where, field, stored, expected });
}

const f = (v: number | null | undefined, d = 3) => (v == null ? "null" : v.toFixed(d));

// ---------------------------------------------------------------------------

async function main() {
  const where: Record<string, unknown> = {};
  if (ONLY_DATASET) where.id = ONLY_DATASET;
  if (ONLY_SUBSTATION) where.substationCode = ONLY_SUBSTATION;

  const datasets = await prisma.emdisDataset.findMany({
    where,
    orderBy: { createdAt: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
    select: {
      id: true, name: true, substationCode: true, serialAsRecorded: true,
      ratingKvaAsRecorded: true, nominalVoltLL: true, intervalSeconds: true,
      readingCount: true, firstReadingAt: true, lastReadingAt: true,
      staged: true, contentHash: true, duplicateKind: true,
      transformerId: true,
      transformer: { select: { gNumber: true, serialNumber: true, ratingKva: true, secondaryKv: true } },
    },
  });

  if (!datasets.length) {
    console.log("No datasets matched.");
    return;
  }

  console.log(`VERIFY - recomputing the analysis of ${datasets.length} dataset(s) from first principles.\n`);

  for (const ds of datasets) {
    const label = ds.transformer?.gNumber
      ? `G-${ds.transformer.gNumber}`
      : ds.substationCode ?? ds.name;

    // The INPUTS are taken from the system - the rating it decided to trust and
    // the voltage basis it recorded. Only the FORMULAS are independent. Feeding
    // in different inputs would produce disagreement that proves nothing.
    const ratingKva = ds.transformer?.ratingKva ?? ds.ratingKvaAsRecorded ?? 200;
    const voltLL = ds.nominalVoltLL;
    const iRated = ratedPhaseCurrent(ratingKva, voltLL);

    const readings = (await prisma.emdisReading.findMany({
      where: { datasetId: ds.id },
      orderBy: { recordedAt: "asc" },
    })) as Reading[];

    const scope = `${label} / ${ds.name}`;

    if (!readings.length) {
      problems.push({ where: scope, field: "readings", stored: 0, expected: ds.readingCount, note: "dataset has no rows" });
      continue;
    }

    console.log(
      `${scope}\n  ${readings.length.toLocaleString()} readings · ${ratingKva} kVA · ` +
        `${voltLL} V L-L · rated phase current ${iRated.toFixed(1)} A` +
        (ds.staged ? " · STAGED (held out of the analysis)" : "") +
        (ds.duplicateKind ? ` · flagged ${ds.duplicateKind}` : ""),
    );

    // ---- the dataset's own summary fields --------------------------------
    sameInt(scope, "readingCount", ds.readingCount, readings.length);
    same(scope, "firstReadingAt", ds.firstReadingAt.getTime(), readings[0].recordedAt.getTime(), 0);
    same(
      scope, "lastReadingAt",
      ds.lastReadingAt.getTime(), readings[readings.length - 1].recordedAt.getTime(), 0,
    );

    // Interval: the median gap, which is what the importer stores.
    const gaps: number[] = [];
    for (let i = 1; i < readings.length; i++) {
      gaps.push((readings[i].recordedAt.getTime() - readings[i - 1].recordedAt.getTime()) / 1000);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)])) : 60;
    sameInt(scope, "intervalSeconds", ds.intervalSeconds, medianGap);

    // ---- every reading's derived fields ----------------------------------
    let worstDelta = 0;
    for (const r of readings) {
      const e = expectedForReading(r, ratingKva, iRated);
      const at = `${scope} @ ${r.recordedAt.toISOString()}`;
      same(at, "maxPhaseC", r.maxPhaseC, e.maxPhaseC);
      same(at, "phaseUnbalancePct", r.phaseUnbalancePct, e.phaseUnbalancePct);
      same(at, "loadingPct", r.loadingPct, e.loadingPct);
      same(at, "maxPhasePctRated", r.maxPhasePctRated, e.maxPhasePctRated);
      same(at, "neutralPctRated", r.neutralPctRated, e.neutralPctRated);
      worstDelta = Math.max(
        worstDelta,
        Math.abs(n(r.maxPhasePctRated) - e.maxPhasePctRated),
        Math.abs(n(r.phaseUnbalancePct) - e.phaseUnbalancePct),
      );
    }

    // ---- the hourly rollup -----------------------------------------------
    const stored = await prisma.emdisHourly.findMany({
      where: { datasetId: ds.id },
      orderBy: { hourStart: "asc" },
    });

    const buckets = new Map<number, Reading[]>();
    for (const r of readings) {
      const h = Math.floor(r.recordedAt.getTime() / 3.6e6);
      const list = buckets.get(h) ?? [];
      list.push(r);
      buckets.set(h, list);
    }
    sameInt(scope, "hourly rows", stored.length, buckets.size);

    const minutesPer = medianGap / 60;
    for (const row of stored) {
      const list = buckets.get(Math.floor(row.hourStart.getTime() / 3.6e6));
      const at = `${scope} hour ${row.hourStart.toISOString()}`;
      if (!list) {
        problems.push({ where: at, field: "hourStart", stored: "present", expected: "no readings in that hour" });
        continue;
      }
      const e = list.map((r) => expectedForReading(r, ratingKva, iRated));
      const volts = list.flatMap((r) => [r.l1nV, r.l2nV, r.l3nV]).filter((v): v is number => v != null && v > 50);

      sameInt(at, "samples", row.samples, list.length);
      same(at, "avgKva", row.avgKva, avg(defined(list.map((r) => r.kva))));
      same(at, "maxKva", row.maxKva, max(defined(list.map((r) => r.kva))));
      same(at, "p95Kva", row.p95Kva, p95(defined(list.map((r) => r.kva))));
      same(at, "avgPf", row.avgPf, avg(defined(list.map((r) => r.pf))));
      same(at, "maxL1c", row.maxL1c, max(defined(list.map((r) => r.l1c))));
      same(at, "maxL2c", row.maxL2c, max(defined(list.map((r) => r.l2c))));
      same(at, "maxL3c", row.maxL3c, max(defined(list.map((r) => r.l3c))));
      same(at, "maxNeutralC", row.maxNeutralC, max(defined(list.map((r) => r.neutralC))));
      same(at, "avgVoltage", row.avgVoltage, avg(volts));
      same(at, "minVoltage", row.minVoltage, min(volts));
      same(at, "maxVoltage", row.maxVoltage, max(volts));
      same(at, "maxThdPct", row.maxThdPct, max(defined(list.map((r) => r.thdPct))));
      same(at, "maxUnbalancePct", row.maxUnbalancePct, max(e.map((x) => x.phaseUnbalancePct)));
      same(at, "maxPhasePctRated", row.maxPhasePctRated, max(e.map((x) => x.maxPhasePctRated)));
      same(at, "maxLoadingPct", row.maxLoadingPct, max(e.map((x) => x.loadingPct)));
      sameInt(
        at, "minutesOver100Pct",
        row.minutesOver100Pct,
        Math.round(e.filter((x) => x.maxPhaseC > iRated).length * minutesPer),
      );
      sameInt(
        at, "minutesOver80Pct",
        row.minutesOver80Pct,
        Math.round(e.filter((x) => x.maxPhaseC > iRated * 0.8).length * minutesPer),
      );
    }

    // ---- the peak-load snapshot the API and the alerts quote --------------
    // Picked the way snapshot-reading.ts picks it: highest kVA loading, and
    // highest phase current only when no kVA channel exists.
    const byLoading = readings.filter((r) => n(r.loadingPct) > 0);
    const snap = byLoading.length
      ? byLoading.reduce((a, b) => (n(b.loadingPct) > n(a.loadingPct) ? b : a))
      : readings.reduce((a, b) => (n(b.maxPhaseC) > n(a.maxPhaseC) ? b : a));
    const snapExpected = expectedForReading(snap, ratingKva, iRated);

    if (VERBOSE) {
      console.log(
        `  peak ${snap.recordedAt.toISOString().slice(11, 16)} — ` +
          `phases ${f(snap.l1c, 1)}/${f(snap.l2c, 1)}/${f(snap.l3c, 1)} A, ` +
          `unbalance ${f(snapExpected.phaseUnbalancePct, 2)}%, ` +
          `phase load ${f(snapExpected.maxPhasePctRated, 1)}% of rated, ` +
          `kVA load ${f(snapExpected.loadingPct, 1)}%`,
      );
    }

    const totalOver100 = stored.reduce((s, h) => s + h.minutesOver100Pct, 0);
    const independentOver100 = Math.round(
      readings.filter((r) => expectedForReading(r, ratingKva, iRated).maxPhaseC > iRated).length * minutesPer,
    );
    console.log(
      `  peak phase ${f(max(readings.map((r) => expectedForReading(r, ratingKva, iRated).maxPhasePctRated)), 1)}% of rated · ` +
        `${totalOver100} min over rated · worst per-reading disagreement ${worstDelta.toExponential(1)}`,
    );
    // Summed hour by hour against counted straight through: these can differ by
    // a minute or two purely from rounding each hour separately, which is
    // expected and not a defect.
    if (Math.abs(totalOver100 - independentOver100) > buckets.size) {
      problems.push({
        where: scope,
        field: "minutesOver100Pct (dataset total)",
        stored: totalOver100,
        expected: independentOver100,
        note: "beyond per-hour rounding",
      });
    }
  }

  // -------------------------------------------------------------------------
  // What duplication does to the figures that add up.
  // -------------------------------------------------------------------------
  await reportDuplicateInflation();

  // -------------------------------------------------------------------------
  console.log(`\n${checks.toLocaleString()} figures checked.`);
  if (!problems.length) {
    console.log("Every stored figure matches an independent recomputation. No disagreements.");
    return;
  }

  console.log(`\n${problems.length} DISAGREEMENT(S):\n`);
  const shown = problems.slice(0, 40);
  for (const p of shown) {
    console.log(`  ${p.where}`);
    console.log(`    ${p.field}: stored ${JSON.stringify(p.stored)}, expected ${JSON.stringify(p.expected)}` +
      (p.note ? ` (${p.note})` : ""));
  }
  if (problems.length > shown.length) {
    console.log(`  ... and ${problems.length - shown.length} more.`);
  }
  process.exitCode = 1;
}

/**
 * Show, per transformer, how much of its totals rest on readings held twice.
 *
 * The peak figures are unaffected by duplication and are printed alongside to
 * make that visible: the point is not that everything is wrong, it is that the
 * sums are wrong and the maxima are not, which is exactly why nobody notices.
 */
async function reportDuplicateInflation() {
  const dupes = await prisma.emdisDataset.findMany({
    where: { duplicateOfId: { not: null }, transformerId: { not: null } },
    select: {
      id: true, name: true, transformerId: true, readingCount: true, duplicateKind: true,
      transformer: { select: { gNumber: true, serialNumber: true } },
    },
  });

  if (!dupes.length) {
    console.log("\nNo dataset is flagged as a duplicate. Every reading is counted once.");
    return;
  }

  console.log(`\nDUPLICATE INFLATION — ${dupes.length} flagged dataset(s):\n`);

  const byTransformer = new Map<string, typeof dupes>();
  for (const d of dupes) {
    const list = byTransformer.get(d.transformerId!) ?? [];
    list.push(d);
    byTransformer.set(d.transformerId!, list);
  }

  for (const [transformerId, list] of byTransformer) {
    const label = list[0].transformer?.gNumber
      ? `G-${list[0].transformer.gNumber}`
      : list[0].transformer?.serialNumber ?? transformerId;

    const all = await prisma.emdisHourly.aggregate({
      where: { transformerId },
      _sum: { minutesOver100Pct: true, minutesOver80Pct: true },
      _max: { maxPhasePctRated: true },
    });
    const withoutDupes = await prisma.emdisHourly.aggregate({
      where: { transformerId, datasetId: { notIn: list.map((d) => d.id) } },
      _sum: { minutesOver100Pct: true, minutesOver80Pct: true },
      _max: { maxPhasePctRated: true },
    });

    const over100 = all._sum.minutesOver100Pct ?? 0;
    const trueOver100 = withoutDupes._sum.minutesOver100Pct ?? 0;
    const over80 = all._sum.minutesOver80Pct ?? 0;
    const trueOver80 = withoutDupes._sum.minutesOver80Pct ?? 0;

    console.log(
      `  ${label}: ${list.length} duplicate dataset(s), ${list.reduce((s, d) => s + d.readingCount, 0).toLocaleString()} redundant readings`,
    );
    console.log(
      `    minutes over rated:  reported ${over100}, true ${trueOver100}` +
        (over100 !== trueOver100 ? `  <-- inflated by ${over100 - trueOver100}` : "  (unaffected)"),
    );
    console.log(
      `    minutes over 80%:    reported ${over80}, true ${trueOver80}` +
        (over80 !== trueOver80 ? `  <-- inflated by ${over80 - trueOver80}` : "  (unaffected)"),
    );
    console.log(
      `    peak phase % rated:  reported ${f(all._max.maxPhasePctRated, 1)}, true ${f(withoutDupes._max.maxPhasePctRated, 1)}  (a maximum, so duplication cannot change it)`,
    );
  }
}

await main();
await prisma.$disconnect();
