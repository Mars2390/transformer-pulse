/**
 * The snapshot reading. ONE row in, ONE set of numbers out.
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
 * The snapshot rule is the engine's rule, unchanged: peak kVA loading wins;
 * with no kVA channel, peak phase current; ties go to the later reading.
 */
import { prisma } from './prisma';
import { nemaUnbalancePct, ratedPhaseCurrent, NOMINAL_VLL } from './load-analysis';

/** The minimum a row must carry to be derived from. Structural on purpose. */
export type SnapshotRow = {
  recordedAt?: Date | string | null;
  l1c?: number | null;
  l2c?: number | null;
  l3c?: number | null;
  neutralC?: number | null;
  kva?: number | null;
  maxPhaseC?: number | null;
  loadingPct?: number | null;
};

export type SnapshotMetrics = {
  recordedAt: Date | null;
  ratingKva: number;
  voltLL: number;
  iRated: number;
  l1c: number;
  l2c: number;
  l3c: number;
  neutralC: number;
  kva: number;
  /** kVA as a percentage of nameplate. The 130.98% figure. */
  loadingPct: number;
  /** NEMA MG-1 on THIS row. The 42.72% figure. The only unbalance there is. */
  unbalancePct: number;
  /** Worst phase against rated current. The figure the kVA number hides. */
  maxPhasePctRated: number;
  /**
   * The worst phase in amperes, and which phase it was.
   *
   * Exposed because the thermal model's K is this current over rated current,
   * and anyone checking a hot-spot by hand needs the two numbers that produced
   * it — not a percentage they have to work backwards from.
   */
  maxPhaseC: number;
  hottestPhase: 'L1' | 'L2' | 'L3' | null;
  neutralPctRated: number;
  pickedBy: 'peak kVA loading' | 'peak phase current' | 'no readings';
  /** The arithmetic, spelled out, for manual-versus-system comparison. */
  arithmetic: string;
};

const num = (x: number | null | undefined): number =>
  x == null || !Number.isFinite(x) ? 0 : x;

export const EMPTY_SNAPSHOT: SnapshotMetrics = {
  recordedAt: null, ratingKva: 0, voltLL: NOMINAL_VLL, iRated: 0,
  l1c: 0, l2c: 0, l3c: 0, neutralC: 0, kva: 0,
  loadingPct: 0, unbalancePct: 0, maxPhasePctRated: 0,
  maxPhaseC: 0, hottestPhase: null, neutralPctRated: 0,
  pickedBy: 'no readings', arithmetic: 'no readings',
};

/**
 * Derive every snapshot figure from one row. Pure - no database, no clock - so
 * the import path, the API path and the unit tests all run the same code.
 */
export function deriveSnapshotMetrics(
  row: SnapshotRow,
  ratingKva: number,
  voltLL: number = NOMINAL_VLL,
  pickedBy: SnapshotMetrics['pickedBy'] = 'peak kVA loading',
): SnapshotMetrics {
  const l1 = num(row.l1c);
  const l2 = num(row.l2c);
  const l3 = num(row.l3c);
  const neutral = num(row.neutralC);
  const kva = num(row.kva);
  const iRated = ratedPhaseCurrent(ratingKva, voltLL);
  const maxPhase = Math.max(l1, l2, l3, num(row.maxPhaseC));
  const mean = (l1 + l2 + l3) / 3;
  const unbalancePct = nemaUnbalancePct(l1, l2, l3);
  const recordedAt = row.recordedAt ? new Date(row.recordedAt) : null;

  return {
    recordedAt,
    ratingKva,
    voltLL,
    iRated,
    l1c: l1, l2c: l2, l3c: l3, neutralC: neutral, kva,
    loadingPct: ratingKva > 0 ? (kva / ratingKva) * 100 : 0,
    unbalancePct,
    maxPhasePctRated: iRated > 0 ? (maxPhase / iRated) * 100 : 0,
    maxPhaseC: maxPhase,
    // Named from the three phase readings, not from the stored maxPhaseC — a
    // stored maximum has no phase label, and reporting the wrong letter beside
    // a correct number is worse than reporting no letter at all.
    hottestPhase:
      maxPhase <= 0 || maxPhase !== Math.max(l1, l2, l3)
        ? null
        : (['L1', 'L2', 'L3'] as const)[[l1, l2, l3].indexOf(maxPhase)],
    neutralPctRated: iRated > 0 ? (neutral / iRated) * 100 : 0,
    pickedBy,
    arithmetic:
      'I_avg ' + mean.toFixed(2) + ' A; max deviation ' +
      Math.max(Math.abs(l1 - mean), Math.abs(l2 - mean), Math.abs(l3 - mean)).toFixed(2) +
      ' A; NEMA ' + unbalancePct.toFixed(2) + '%',
  };
}

/**
 * The same pick, applied to rows already in memory at import time. Used by the
 * alert generator so raising an alert costs no extra query and, more to the
 * point, cannot select a different instant than the API does.
 */
export function pickSnapshotRow<T extends SnapshotRow>(
  rows: readonly T[],
): { row: T | null; pickedBy: SnapshotMetrics['pickedBy'] } {
  if (!rows.length) return { row: null, pickedBy: 'no readings' };
  const anyKva = rows.some((r) => num(r.loadingPct) > 0);
  const key = (r: T) => (anyKva ? num(r.loadingPct) : num(r.maxPhaseC));
  let best = rows[0];
  for (const r of rows.slice(1)) {
    // >= so a repeat of the same peak resolves to the LATER reading, which is
    // the one an engineer is being asked about.
    if (key(r) >= key(best)) best = r;
  }
  return { row: best, pickedBy: anyKva ? 'peak kVA loading' : 'peak phase current' };
}

const READING_SELECT = {
  recordedAt: true,
  l1c: true, l2c: true, l3c: true, neutralC: true,
  kva: true, maxPhaseC: true, loadingPct: true,
  dataset: { select: { nominalVoltLL: true } },
};

/**
 * The snapshot for one transformer, straight from the database.
 *
 * Two indexed reads at worst, no scan of the reading table in application code
 * and no hourly rollup anywhere near it. The rollup answers 'what was the worst
 * hour this year'; that is a different and equally valid question, and it must
 * never be printed under the same heading as this one.
 */
export async function snapshotMetricsFor(
  transformerId: string,
  ratingKva: number,
): Promise<SnapshotMetrics> {
  const byKva = await prisma.emdisReading.findFirst({
    where: { dataset: { transformerId }, loadingPct: { gt: 0 } },
    orderBy: [{ loadingPct: 'desc' }, { recordedAt: 'desc' }],
    select: READING_SELECT,
  });
  if (byKva) {
    return deriveSnapshotMetrics(byKva, ratingKva, byKva.dataset.nominalVoltLL, 'peak kVA loading');
  }

  const byCurrent = await prisma.emdisReading.findFirst({
    where: { dataset: { transformerId } },
    orderBy: [{ maxPhaseC: 'desc' }, { recordedAt: 'desc' }],
    select: READING_SELECT,
  });
  if (byCurrent) {
    return deriveSnapshotMetrics(byCurrent, ratingKva, byCurrent.dataset.nominalVoltLL, 'peak phase current');
  }

  return { ...EMPTY_SNAPSHOT, ratingKva };
}

/**
 * Snapshots for a fleet, for the cached-score refresh. Bounded concurrency:
 * the health refresh runs over every transformer in a region, and firing a
 * thousand simultaneous queries at Postgres to fix a correctness bug would
 * simply trade one incident for another.
 */
export async function snapshotMetricsForMany(
  transformers: readonly { id: string; ratingKva: number }[],
  concurrency = 8,
): Promise<Map<string, SnapshotMetrics>> {
  const out = new Map<string, SnapshotMetrics>();
  for (let i = 0; i < transformers.length; i += concurrency) {
    const batch = transformers.slice(i, i + concurrency);
    const done = await Promise.all(
      batch.map(async (t) => [t.id, await snapshotMetricsFor(t.id, t.ratingKva)] as const),
    );
    for (const [id, m] of done) out.set(id, m);
  }
  return out;
}
