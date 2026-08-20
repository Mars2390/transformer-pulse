import { prisma } from './prisma';
import { THERMAL_CONSTANT_SELECT } from './thermal-constants';
import { ambientForMonth } from './load-balancing';
import {
  deriveSnapshot,
  pickSnapshotRow as pickBest,
  type DerivedSnapshot,
  type SnapshotSourceRow,
} from './analysis-snapshot';

/**
 * Reading the snapshot out of the database.
 *
 * Every divergent unbalance figure in this system came from the same place:
 * four callers each aggregated the readings differently and all four called the
 * result 'unbalance'.
 *
 *   API field      63.0%   max within the LATEST HOUR rollup
 *   Alert         136.0%   MEDIAN across the whole upload window
 *   Health record 171.0%   MAX of every hourly maximum ever recorded
 *   Manual NEMA    42.72%  the snapshot reading, the one loadingPct uses
 *
 * None of the three were wrong arithmetic. They were three different questions
 * wearing one label. This module answers the only question the report claims to
 * be answering: at the instant of peak load, what did the three phases read?
 *
 * ---------------------------------------------------------------------------
 * What this file is, and what it deliberately is not
 * ---------------------------------------------------------------------------
 * It is the DATABASE half, and nothing more: pick the row, fetch the rating,
 * the voltage basis and the transformer's thermal constants, and hand them to
 * analysis-snapshot.ts. Every figure comes back from deriveSnapshot().
 *
 * It used to carry its own copy of the arithmetic. Two derivations of "the
 * snapshot" is the same disease this module was written to cure, one level
 * down — the copies agreed on unbalance and diverged on everything else,
 * because only one of them computed a hot-spot at all.
 *
 * The snapshot rule is unchanged: peak kVA loading wins; with no kVA channel,
 * peak phase current; ties go to the later reading.
 */

/** The minimum a row must carry to be derived from. Structural on purpose. */
export type SnapshotRow = SnapshotSourceRow;

/** The derived figures. One shape, produced in one place. */
export type SnapshotMetrics = DerivedSnapshot;

export { deriveSnapshot } from './analysis-snapshot';

/**
 * The rows and columns a derivation needs, plus the transformer's certificate
 * constants. Exported so a caller assembling its own query cannot forget one.
 */
const READING_SELECT = {
  recordedAt: true,
  l1c: true, l2c: true, l3c: true, neutralC: true,
  l1nV: true, l2nV: true, l3nV: true,
  kva: true, kw: true, pf: true, thdPct: true,
  maxPhaseC: true, loadingPct: true, maxPhasePctRated: true,
  phaseUnbalancePct: true, neutralPctRated: true,
  dataset: {
    select: {
      nominalVoltLL: true,
      transformer: { select: { secondaryKv: true, ...THERMAL_CONSTANT_SELECT } },
    },
  },
} as const;

type FetchedRow = {
  recordedAt: Date;
  dataset: {
    nominalVoltLL: number;
    transformer: {
      secondaryKv: number | null;
      lossRatioR: number | null;
      topOilRiseK: number | null;
      hotSpotGradientK: number | null;
      windingExponentX: number | null;
      oilExponentY: number | null;
    } | null;
  };
} & SnapshotSourceRow;

/**
 * The voltage every per-phase judgement hangs on.
 *
 * The transformer's own secondary winding when the register knows it, because
 * EMDis is LV-side metering; otherwise whatever the dataset recorded. Held here
 * rather than at each call site so the analysis screen and the alert cannot end
 * up dividing by different voltages.
 */
function voltageBasis(row: FetchedRow): number {
  const secondaryV = row.dataset.transformer?.secondaryKv
    ? row.dataset.transformer.secondaryKv * 1000
    : null;
  return secondaryV && secondaryV > 100 ? secondaryV : row.dataset.nominalVoltLL;
}

function deriveFetched(row: FetchedRow, ratingKva: number, selectedBecause: string): DerivedSnapshot {
  return deriveSnapshot({
    row,
    ratingKva,
    voltLL: voltageBasis(row),
    // Ambient is a property of WHEN the reading was taken, so it is derived
    // here from the row itself. Passing it in per call site is how one screen
    // ends up modelling a January evening at a June temperature.
    ambientC: ambientForMonth(row.recordedAt.getUTCMonth()),
    transformer: row.dataset.transformer,
    selectedBecause,
  });
}

/**
 * The snapshot for one transformer, straight from the database.
 *
 * Two indexed reads at worst, no scan of the reading table in application code
 * and no hourly rollup anywhere near it. The rollup answers 'what was the worst
 * hour this year'; that is a different and equally valid question, and it must
 * never be printed under the same heading as this one.
 *
 * Returns null when the transformer has no load data. Deliberately null and not
 * a zeroed object: a transformer nobody has measured is not a transformer
 * running at 0 A, and an empty snapshot that quietly reports 0% unbalance reads
 * on a dashboard as a clean bill of health.
 */
export async function snapshotMetricsFor(
  transformerId: string,
  ratingKva: number,
): Promise<DerivedSnapshot | null> {
  const byKva = await prisma.emdisReading.findFirst({
    where: { dataset: { transformerId, staged: false }, loadingPct: { gt: 0 } },
    orderBy: [{ loadingPct: 'desc' }, { recordedAt: 'desc' }],
    select: READING_SELECT,
  });
  if (byKva) return deriveFetched(byKva, ratingKva, 'peak measured loading in this window');

  const byCurrent = await prisma.emdisReading.findFirst({
    where: { dataset: { transformerId, staged: false } },
    orderBy: [{ maxPhaseC: 'desc' }, { recordedAt: 'desc' }],
    select: READING_SELECT,
  });
  if (byCurrent) {
    return deriveFetched(
      byCurrent, ratingKva,
      'peak phase current in this window (no kVA channel in the export)',
    );
  }

  return null;
}

/**
 * Snapshots for a fleet, for the cached-score refresh. Bounded concurrency:
 * the health refresh runs over every transformer in a region, and firing a
 * thousand simultaneous queries at Postgres to fix a correctness bug would
 * simply trade one incident for another.
 *
 * Transformers with no load data are absent from the map, not present with
 * zeroes.
 */
export async function snapshotMetricsForMany(
  transformers: readonly { id: string; ratingKva: number }[],
  concurrency = 8,
): Promise<Map<string, DerivedSnapshot>> {
  const out = new Map<string, DerivedSnapshot>();
  for (let i = 0; i < transformers.length; i += concurrency) {
    const batch = transformers.slice(i, i + concurrency);
    const done = await Promise.all(
      batch.map(async (t) => [t.id, await snapshotMetricsFor(t.id, t.ratingKva)] as const),
    );
    for (const [id, m] of done) if (m) out.set(id, m);
  }
  return out;
}

/**
 * The same pick, applied to rows already in memory at import time. Used by the
 * alert generator so raising an alert costs no extra query and, more to the
 * point, cannot select a different instant than the API does.
 */
export function pickSnapshotRow<T extends SnapshotSourceRow>(
  rows: readonly T[],
): { row: T | null; pickedBy: string } {
  const picked = pickBest([...rows]);
  return picked ? { row: picked.row, pickedBy: picked.reason } : { row: null, pickedBy: 'no readings' };
}
