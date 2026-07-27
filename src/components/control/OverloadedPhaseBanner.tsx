import { formatKes } from "@/lib/format";
import { PHASE_META } from "@/lib/phase-colors";
import type { PhaseDistributionRow } from "@/lib/phase-distribution";

/**
 * The single most important fact on the whole screen, said once, at the top,
 * in one sentence a non-engineer can act on — before any chart or table.
 */
export function OverloadedPhaseBanner({
  heaviest,
  ratedPhaseA,
  minutesOverRated,
  hotspotC,
  ageingRate,
  yearsToEndOfLife,
  currentPerHourKes,
  datasetId,
}: {
  heaviest: PhaseDistributionRow;
  ratedPhaseA: number;
  minutesOverRated: number;
  hotspotC: number;
  ageingRate: number;
  yearsToEndOfLife: number;
  currentPerHourKes: number;
  datasetId: string;
}) {
  const meta = PHASE_META[heaviest.phase];
  const overloaded = heaviest.pctRated >= 100;

  if (!overloaded) {
    return (
      <div className="rounded-2xl border-2 border-kplc/30 bg-kplc/5 px-5 py-4">
        <p className="text-sm font-extrabold text-kplc">
          ✅ No phase is currently overloaded
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Heaviest is {meta.label} at {heaviest.pctRated.toFixed(0)}% of {ratedPhaseA.toFixed(0)} A rated.
        </p>
      </div>
    );
  }

  const overAmps = heaviest.amps - ratedPhaseA;
  const hrs = (m: number) => (m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(0)} min`);

  return (
    <div className="overflow-hidden rounded-2xl border-2" style={{ borderColor: meta.colour }}>
      <div className="px-5 py-4" style={{ backgroundColor: meta.colour + "14" }}>
        <p className="text-lg font-extrabold" style={{ color: meta.colour }}>
          {meta.dot} {meta.word.toUpperCase()} PHASE ({heaviest.phase}) IS CRITICALLY OVERLOADED
        </p>

        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
          <p><strong className="text-navy">{heaviest.amps.toFixed(0)} Amps</strong> — {heaviest.pctRated.toFixed(0)}% of {ratedPhaseA.toFixed(0)} Amp rating</p>
          <p><strong className="text-navy">{overAmps.toFixed(0)} Amps</strong> over the limit</p>
          <p><strong className="text-navy">{hrs(minutesOverRated)}</strong> above rated (last measured window)</p>
          <p>~<strong className="text-navy">{heaviest.estimatedCustomers}</strong> customers on this phase</p>
          <p>Hot-spot: <strong className="text-navy">{hotspotC.toFixed(0)}°C</strong> (IEC limit: 120°C)</p>
          <p>Ageing: <strong className="text-navy">{ageingRate.toFixed(0)}×</strong> normal</p>
          <p>Time to failure at current rate: <strong className="text-navy">{yearsToEndOfLife < 1 ? `${(yearsToEndOfLife * 12).toFixed(1)} months` : `${yearsToEndOfLife.toFixed(1)} years`}</strong></p>
          <p>Cost: <strong className="text-navy">{formatKes(currentPerHourKes)}/hour</strong> in consumed asset life</p>
        </div>

        <p className="mt-3 text-sm font-extrabold" style={{ color: meta.colour }}>
          RECOMMENDED: {heaviest.recommendation}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href="#balancing-plan"
            className="rounded-lg px-4 py-2 text-xs font-bold text-white"
            style={{ backgroundColor: meta.colour }}
          >
            View Load Balancing Plan
          </a>
          <a
            href={`/api/xlsx/load-analysis/${datasetId}`}
            className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
          >
            Export Phase Report
          </a>
        </div>
      </div>
    </div>
  );
}
