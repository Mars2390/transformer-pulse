import { LIMITS } from "./load-analysis";

/**
 * Building the hourly rollup from analysed readings.
 *
 * Pulled out of the importer because it is now needed in two places — ingest,
 * and approving a staged dataset once a human has named its transformer, which
 * changes the rated current and therefore every percentage in the rollup. Two
 * copies of this arithmetic would mean a dataset's numbers depending on which
 * door it came through, and the whole promise of the analysis is that they do
 * not.
 */

/**
 * A reading with its derived fields already computed by analyseReading().
 *
 * Every measurement is optional as well as nullable, so a Prisma
 * CreateManyInput — where an unset column is `undefined`, not null — can be
 * passed straight in without being copied into a second shape first. The
 * difference between "the meter did not report this" and "this key is absent"
 * is not a difference an hourly average can act on.
 */
export type AnalysedRow = {
  recordedAt: Date;
  l1nV?: number | null; l2nV?: number | null; l3nV?: number | null;
  l1c?: number | null; l2c?: number | null; l3c?: number | null;
  neutralC?: number | null;
  kva?: number | null; kw?: number | null; pf?: number | null; thdPct?: number | null;
  maxPhaseC?: number | null;
  phaseUnbalancePct?: number | null;
  loadingPct?: number | null;
  maxPhasePctRated?: number | null;
};

export type HourlyRow = {
  datasetId: string;
  transformerId: string | null;
  hourStart: Date;
  samples: number;
  avgKva: number | null; maxKva: number | null; p95Kva: number | null;
  avgKw: number | null; avgPf: number | null;
  avgL1c: number | null; avgL2c: number | null; avgL3c: number | null;
  maxL1c: number | null; maxL2c: number | null; maxL3c: number | null;
  avgNeutralC: number | null; maxNeutralC: number | null;
  avgVoltage: number | null; minVoltage: number | null; maxVoltage: number | null;
  avgThdPct: number | null; maxThdPct: number | null;
  avgUnbalancePct: number | null; maxUnbalancePct: number | null;
  maxLoadingPct: number | null;
  maxPhasePctRated: number | null;
  minutesOver80Pct: number;
  minutesOver100Pct: number;
};

const pick = <T,>(list: readonly T[], f: (r: T) => number | null | undefined) =>
  list.map(f).filter((v): v is number => v != null && Number.isFinite(v));
const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const max = (v: number[]) => (v.length ? Math.max(...v) : null);
const min = (v: number[]) => (v.length ? Math.min(...v) : null);
const p95 = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(0.95 * (s.length - 1))];
};

/**
 * Group analysed readings into whole UTC hours and summarise each one.
 *
 * `iRated` is passed in rather than derived here, because it depends on the
 * rating the caller decided to trust — the register's, or the file header's —
 * and that decision belongs upstream where it can be explained to a reader.
 */
export function rollupHourly(
  rows: readonly AnalysedRow[],
  opts: { datasetId: string; transformerId: string | null; intervalSeconds: number; iRated: number },
): HourlyRow[] {
  const buckets = new Map<number, AnalysedRow[]>();
  for (const row of rows) {
    const h = Math.floor(row.recordedAt.getTime() / 3.6e6);
    const list = buckets.get(h) ?? [];
    list.push(row);
    buckets.set(h, list);
  }

  const minutesPer = opts.intervalSeconds / 60;

  return [...buckets.entries()].map(([h, list]) => {
    // A reading below 50 V is the meter being off, not the supply being low.
    // Averaging those in would drag every voltage figure toward zero.
    const volts = list.flatMap((r) => [r.l1nV, r.l2nV, r.l3nV])
      .filter((v): v is number => v != null && v > 50);

    return {
      datasetId: opts.datasetId,
      transformerId: opts.transformerId,
      hourStart: new Date(h * 3.6e6),
      samples: list.length,
      avgKva: avg(pick(list, (r) => r.kva)),
      maxKva: max(pick(list, (r) => r.kva)),
      p95Kva: p95(pick(list, (r) => r.kva)),
      avgKw: avg(pick(list, (r) => r.kw)),
      avgPf: avg(pick(list, (r) => r.pf)),
      avgL1c: avg(pick(list, (r) => r.l1c)),
      avgL2c: avg(pick(list, (r) => r.l2c)),
      avgL3c: avg(pick(list, (r) => r.l3c)),
      maxL1c: max(pick(list, (r) => r.l1c)),
      maxL2c: max(pick(list, (r) => r.l2c)),
      maxL3c: max(pick(list, (r) => r.l3c)),
      avgNeutralC: avg(pick(list, (r) => r.neutralC)),
      maxNeutralC: max(pick(list, (r) => r.neutralC)),
      avgVoltage: avg(volts),
      minVoltage: min(volts),
      maxVoltage: max(volts),
      avgThdPct: avg(pick(list, (r) => r.thdPct)),
      maxThdPct: max(pick(list, (r) => r.thdPct)),
      avgUnbalancePct: avg(pick(list, (r) => r.phaseUnbalancePct)),
      maxUnbalancePct: max(pick(list, (r) => r.phaseUnbalancePct)),
      maxLoadingPct: max(pick(list, (r) => r.loadingPct)),
      maxPhasePctRated: max(pick(list, (r) => r.maxPhasePctRated)),
      // Counted in minutes rather than samples, so a 30-second meter and a
      // 60-second meter report the same hour as the same duration.
      minutesOver80Pct: Math.round(
        list.filter((r) => (r.maxPhaseC ?? 0) > opts.iRated * LIMITS.phaseWarn).length * minutesPer,
      ),
      minutesOver100Pct: Math.round(
        list.filter((r) => (r.maxPhaseC ?? 0) > opts.iRated).length * minutesPer,
      ),
    };
  });
}
