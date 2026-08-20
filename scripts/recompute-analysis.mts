import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { analyseReading, ratedPhaseCurrent, LIMITS, NOMINAL_VLL } from '../src/lib/load-analysis';
import { deriveSnapshot, snapshotArithmetic } from '../src/lib/analysis-snapshot';
import { ambientForMonth } from '../src/lib/load-balancing';
import { raiseLoadAlerts } from '../src/lib/emdis-import';
import { refreshCachedScores } from '../src/lib/combined-health';
import { deriveHealthStatus } from '../src/lib/health-status';

/**
 * Backfill every EMDis-derived value with the corrected engine.
 *
 * The formulas are fixed in code, but the database still holds what the OLD
 * code wrote. Until this runs, G-38104 shows 42.72% on any freshly imported
 * file and 63/136/171% on everything already stored - which is worse than the
 * original bug, because now two readings of the same transformer disagree and
 * nobody can tell which build produced which.
 *
 * What it recomputes, in dependency order:
 *
 *   EmdisReading   phaseUnbalancePct, maxPhaseC, maxPhasePctRated,
 *                  neutralPctRated, loadingPct  - via analyseReading(), the
 *                  same function the importer calls
 *   EmdisHourly    rebuilt from the corrected readings, hour by hour
 *   Alert          the two snapshot-derived types replaced with values that
 *                  match the API field
 *   Transformer    electricalStressScore, physicalConditionScore, priorityRank
 *                  via refreshCachedScores(); the health explanation string is
 *                  derived on read from those scores, so it follows for free
 *
 * SAFETY: this writes nothing without --apply. The dry run reports exactly what
 * would change, per transformer, including the before and after unbalance.
 *
 * Run:
 *   npx tsx scripts/recompute-analysis.mts                      # dry run, all
 *   npx tsx scripts/recompute-analysis.mts --gnumber 38104      # dry run, one
 *   npx tsx scripts/recompute-analysis.mts --apply              # write
 *   npx tsx scripts/recompute-analysis.mts --apply --keep-alerts
 *   npx tsx scripts/recompute-analysis.mts --apply --purge-acknowledged
 */

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const valueOf = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};

const APPLY = has('--apply');
const KEEP_ALERTS = has('--keep-alerts');
/**
 * Acknowledged alerts are an audit trail: a named human saw that message and
 * signed it off. Replacing the number under their signature rewrites history,
 * so by default only unacknowledged alerts are replaced. The acknowledged ones
 * are counted and listed instead, and --purge-acknowledged replaces them too.
 */
const PURGE_ACK = has('--purge-acknowledged');
const ONLY_G = valueOf('--gnumber');
const PAGE = Math.max(500, Number(valueOf('--page') ?? 5000));

/** The two alert types this analysis path owns. Nothing else is touched. */
const SNAPSHOT_ALERT_TYPES = ['PHASE_UNBALANCE', 'NEUTRAL_CURRENT_HIGH'] as const;

const EPS = 1e-9;
const differs = (a: number | null, b: number | null) => {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > EPS;
};
const f2 = (n: number | null | undefined) => (n == null ? 'null' : n.toFixed(2));

type HourBucket = {
  hourStart: Date;
  rows: {
    kva: number | null; kw: number | null; pf: number | null;
    l1c: number | null; l2c: number | null; l3c: number | null;
    neutralC: number | null; thdPct: number | null;
    l1nV: number | null; l2nV: number | null; l3nV: number | null;
    phaseUnbalancePct: number; loadingPct: number;
    maxPhaseC: number; maxPhasePctRated: number;
  }[];
};

const pick = <T,>(list: T[], f: (r: T) => number | null | undefined) =>
  list.map(f).filter((v): v is number => v != null && Number.isFinite(v));
const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const max = (v: number[]) => (v.length ? Math.max(...v) : null);
const min = (v: number[]) => (v.length ? Math.min(...v) : null);
const p95 = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(0.95 * (s.length - 1))];
};

async function main() {
  const started = Date.now();
  console.log(APPLY ? 'RECOMPUTE - applying changes' : 'RECOMPUTE - dry run, no writes');

  const datasets = await prisma.emdisDataset.findMany({
    where: { transformerId: { not: null } },
    orderBy: { firstReadingAt: 'asc' },
    select: {
      id: true, name: true, nominalVoltLL: true, ratingKvaAsRecorded: true,
      intervalSeconds: true, transformerId: true,
      transformer: { select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, secondaryKv: true, lossRatioR: true, topOilRiseK: true, hotSpotGradientK: true, windingExponentX: true, oilExponentY: true } },
    },
  });

  const wanted = ONLY_G ? String(ONLY_G).replace(/^G-/i, '') : null;
  const byTransformer = new Map<string, typeof datasets>();
  for (const d of datasets) {
    if (!d.transformer) continue;
    if (wanted && String(d.transformer.gNumber ?? '') !== wanted) continue;
    const list = byTransformer.get(d.transformer.id) ?? [];
    list.push(d);
    byTransformer.set(d.transformer.id, list);
  }

  if (!byTransformer.size) {
    console.log(wanted ? `No EMDis data linked to G-${wanted}.` : 'No EMDis datasets are linked to a transformer.');
    return;
  }

  let readingsSeen = 0;
  let readingsChanged = 0;
  let hourlyWritten = 0;
  let alertsDeleted = 0;
  let alertsKeptAck = 0;
  let alertsRaised = 0;
  const touched: string[] = [];

  for (const [transformerId, list] of byTransformer) {
    const tx = list[0].transformer!;
    const label = tx.gNumber ? `G-${tx.gNumber}` : (tx.serialNumber ?? transformerId);

    // Best snapshot across every dataset for this transformer, so the alert we
    // re-raise quotes the same instant the API will report.
    let bestRow: HourBucket['rows'][0] & { recordedAt: Date } | null = null;
    let bestVoltLL = NOMINAL_VLL;
    let bestRating = tx.ratingKva;
    let before: { unb: number | null; loading: number | null } = { unb: null, loading: null };

    for (const ds of list) {
      const ratingKva = tx.ratingKva || ds.ratingKvaAsRecorded || 0;
      const voltLL = ds.nominalVoltLL || NOMINAL_VLL;
      const iRated = ratedPhaseCurrent(ratingKva, voltLL);
      if (ratingKva <= 0) {
        console.log(`  ${label}: dataset ${ds.name} has no rating on the transformer or the header - skipped`);
        continue;
      }

      let skip = 0;
      let bucket: HourBucket | null = null;
      const flush = async (b: HourBucket) => {
        const volts = b.rows.flatMap((r) => [r.l1nV, r.l2nV, r.l3nV])
          .filter((v): v is number => v != null && v > 50);
        const minutesPer = (ds.intervalSeconds || 60) / 60;
        const data = {
          transformerId,
          samples: b.rows.length,
          avgKva: avg(pick(b.rows, (r) => r.kva)), maxKva: max(pick(b.rows, (r) => r.kva)), p95Kva: p95(pick(b.rows, (r) => r.kva)),
          avgKw: avg(pick(b.rows, (r) => r.kw)), avgPf: avg(pick(b.rows, (r) => r.pf)),
          avgL1c: avg(pick(b.rows, (r) => r.l1c)), avgL2c: avg(pick(b.rows, (r) => r.l2c)), avgL3c: avg(pick(b.rows, (r) => r.l3c)),
          maxL1c: max(pick(b.rows, (r) => r.l1c)), maxL2c: max(pick(b.rows, (r) => r.l2c)), maxL3c: max(pick(b.rows, (r) => r.l3c)),
          avgNeutralC: avg(pick(b.rows, (r) => r.neutralC)), maxNeutralC: max(pick(b.rows, (r) => r.neutralC)),
          avgVoltage: avg(volts), minVoltage: min(volts), maxVoltage: max(volts),
          avgThdPct: avg(pick(b.rows, (r) => r.thdPct)), maxThdPct: max(pick(b.rows, (r) => r.thdPct)),
          avgUnbalancePct: avg(pick(b.rows, (r) => r.phaseUnbalancePct)),
          maxUnbalancePct: max(pick(b.rows, (r) => r.phaseUnbalancePct)),
          maxLoadingPct: max(pick(b.rows, (r) => r.loadingPct)),
          maxPhasePctRated: max(pick(b.rows, (r) => r.maxPhasePctRated)),
          minutesOver80Pct: Math.round(b.rows.filter((r) => r.maxPhaseC > iRated * LIMITS.phaseWarn).length * minutesPer),
          minutesOver100Pct: Math.round(b.rows.filter((r) => r.maxPhaseC > iRated).length * minutesPer),
        };
        if (APPLY) {
          await prisma.emdisHourly.upsert({
            where: { datasetId_hourStart: { datasetId: ds.id, hourStart: b.hourStart } },
            create: { datasetId: ds.id, hourStart: b.hourStart, ...data },
            update: data,
          });
        }
        hourlyWritten++;
      };

      for (;;) {
        const page = await prisma.emdisReading.findMany({
          where: { datasetId: ds.id },
          orderBy: { recordedAt: 'asc' },
          skip,
          take: PAGE,
        });
        if (!page.length) break;
        skip += page.length;
        readingsSeen += page.length;

        // Nullable: neutralPctRated is null when the export carried no neutral
        // channel, and null is the honest value. Coercing it to 0 would report
        // a perfectly balanced neutral on a meter that never measured one.
        const updates: { id: number; data: Record<string, number | null> }[] = [];
        for (const r of page) {
          const a = analyseReading(r, ratingKva, voltLL);

          if (differs(r.phaseUnbalancePct, a.unbalancePct) || differs(r.loadingPct, a.loadingPct)
            || differs(r.maxPhaseC, a.maxPhaseC) || differs(r.maxPhasePctRated, a.maxPhasePctRated)
            || differs(r.neutralPctRated, a.neutralPctRated)) {
            updates.push({
              id: r.id,
              data: {
                phaseUnbalancePct: a.unbalancePct,
                loadingPct: a.loadingPct,
                maxPhaseC: a.maxPhaseC,
                maxPhasePctRated: a.maxPhasePctRated,
                neutralPctRated: a.neutralPctRated,
              },
            });
          }

          const corrected = {
            kva: r.kva, kw: r.kw, pf: r.pf,
            l1c: r.l1c, l2c: r.l2c, l3c: r.l3c,
            neutralC: r.neutralC, thdPct: r.thdPct,
            l1nV: r.l1nV, l2nV: r.l2nV, l3nV: r.l3nV,
            phaseUnbalancePct: a.unbalancePct,
            loadingPct: a.loadingPct,
            maxPhaseC: a.maxPhaseC,
            maxPhasePctRated: a.maxPhasePctRated,
          };

          // Snapshot pick, identical rule to the engine: peak kVA loading, and
          // a later reading wins an exact tie.
          const key = (x: { loadingPct: number; maxPhaseC: number }) => (x.loadingPct > 0 ? x.loadingPct : x.maxPhaseC);
          if (!bestRow || key(corrected) >= key(bestRow)) {
            bestRow = { ...corrected, recordedAt: r.recordedAt };
            bestVoltLL = voltLL;
            bestRating = ratingKva;
            before = { unb: r.phaseUnbalancePct, loading: r.loadingPct };
          }

          // Rollup buckets, flushed as the clock moves on so a year of
          // one-minute data never sits in memory at once.
          const hourStart = new Date(Math.floor(r.recordedAt.getTime() / 3.6e6) * 3.6e6);
          if (!bucket || bucket.hourStart.getTime() !== hourStart.getTime()) {
            if (bucket) await flush(bucket);
            bucket = { hourStart, rows: [] };
          }
          bucket.rows.push(corrected);
        }

        readingsChanged += updates.length;
        if (APPLY && updates.length) {
          for (let i = 0; i < updates.length; i += 500) {
            await prisma.$transaction(
              updates.slice(i, i + 500).map((u) =>
                prisma.emdisReading.update({ where: { id: u.id }, data: u.data }),
              ),
            );
          }
        }

        if (page.length < PAGE) break;
      }
      if (bucket) await flush(bucket);
    }

    if (!bestRow) {
      console.log(`  ${label}: no readings`);
      continue;
    }

    const snap = deriveSnapshot({
      row: bestRow,
      ratingKva: bestRating,
      voltLL: bestVoltLL,
      // The same ambient the API and the alert use, so a recomputed alert
      // cannot quote a different temperature from the one that replaced it.
      ambientC: ambientForMonth(bestRow.recordedAt.getUTCMonth()),
      transformer: tx,
      selectedBecause: 'peak measured loading in this window',
    });
    touched.push(transformerId);

    // Alerts. Only the two snapshot-derived types, and only this transformer.
    const stale = await prisma.alert.findMany({
      where: { transformerId, type: { in: [...SNAPSHOT_ALERT_TYPES] } },
      select: { id: true, acknowledged: true, message: true },
    });
    const replaceable = PURGE_ACK ? stale : stale.filter((a) => !a.acknowledged);
    alertsKeptAck += stale.length - replaceable.length;

    if (!KEEP_ALERTS) {
      alertsDeleted += replaceable.length;
      if (APPLY && replaceable.length) {
        await prisma.alert.deleteMany({ where: { id: { in: replaceable.map((a) => a.id) } } });
      }
      if (APPLY) {
        // The snapshot row is all these two alert types need, by definition.
        const iRated = snap.ratedPhaseA;
        alertsRaised += await raiseLoadAlerts(
          transformerId,
          list[0].id,
          [{ datasetId: list[0].id, recordedAt: bestRow.recordedAt, l1c: bestRow.l1c, l2c: bestRow.l2c, l3c: bestRow.l3c, neutralC: bestRow.neutralC, kva: bestRow.kva, thdPct: bestRow.thdPct, maxPhaseC: bestRow.maxPhaseC, phaseUnbalancePct: snap.unbalancePct, loadingPct: snap.loadingPct, maxPhasePctRated: snap.maxPhasePctRated, neutralPctRated: snap.neutralPctRated }],
          iRated,
          bestRating,
          SNAPSHOT_ALERT_TYPES,
        );
      }
    }

    console.log(
      `  ${label}: unbalance ${f2(before.unb)}% -> ${f2(snap.unbalancePct)}%, ` +
      `loading ${f2(before.loading)}% -> ${f2(snap.loadingPct)}%, ` +
      `${snapshotArithmetic(snap)}, alerts ${replaceable.length} replaced` +
      (stale.length - replaceable.length ? `, ${stale.length - replaceable.length} acknowledged kept` : ''),
    );
  }

  // Scores, priority rank and therefore the health explanation string, which is
  // derived from them on read rather than stored.
  let scored = 0;
  if (APPLY && touched.length) {
    const rows = await refreshCachedScores({ transformerIds: touched });
    scored = rows.length;
    for (const r of rows.slice(0, 10)) {
      const { level, explanation } = deriveHealthStatus({
        electrical: r.electrical, physical: r.physical, status: r.status, reasons: r.reasons,
      });
      console.log(`  ${r.gNumber ? 'G-' + r.gNumber : r.serialNumber}: ${level} - ${explanation}`);
    }
  }

  console.log('');
  console.log(
    `Recomputed ${touched.length} transformers, ${readingsSeen} readings ` +
    `(${readingsChanged} corrected), ${hourlyWritten} hourly rows, ` +
    `${alertsDeleted} alerts replaced by ${alertsRaised}, ${scored} scores refreshed ` +
    `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  if (alertsKeptAck) console.log(`${alertsKeptAck} acknowledged alerts left alone - re-run with --purge-acknowledged to replace them.`);
  if (!APPLY) console.log('Dry run. Nothing was written. Re-run with --apply.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
