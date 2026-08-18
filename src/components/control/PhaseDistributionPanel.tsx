import { PHASE_META, NEUTRAL_META } from "@/lib/phase-colors";
import type { PhaseDistribution } from "@/lib/phase-distribution";
import { formatGNumber } from "@/lib/format";

/**
 * "Who is actually on this phase" — customer counts estimated from current
 * share, never meter-level truth. Every heading below says "estimated" or
 * "≈" for exactly that reason.
 */
export function PhaseDistributionPanel({
  gNumber,
  ratedPhaseA,
  distribution,
  neutral,
}: {
  gNumber: string | null;
  ratedPhaseA: number;
  distribution: PhaseDistribution;
  neutral: { amps: number; pctRated: number };
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-sm font-bold text-navy">
          👥 Phase Distribution{gNumber ? ` — ${formatGNumber(gNumber)}` : ""}
        </h2>
        <p className="mt-0.5 text-xs text-ink-soft">
          Transformer serves approximately <strong className="text-navy">{distribution.estimatedTotalCustomers}</strong> customers
          — estimated from nameplate capacity ({KVA_HINT}), not a meter count.
        </p>
      </div>

      <div className="divide-y divide-line">
        {distribution.phases.map((row) => {
          const meta = PHASE_META[row.phase];
          return (
            <div key={row.phase} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-extrabold" style={{ color: meta.colour }}>
                  {meta.dot} {meta.word.toUpperCase()} PHASE ({row.phase}) — {row.amps.toFixed(0)} Amps ·{" "}
                  {row.pctRated.toFixed(0)}% of {ratedPhaseA.toFixed(0)}A rated
                </p>
              </div>
              <p className="mt-1.5 text-xs font-bold" style={{ color: row.status.colour }}>
                Status: {row.status.label} {row.status.emoji}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-ink-soft">Estimated customers</dt>
                  <dd className="font-bold text-navy">~{row.estimatedCustomers}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Average per customer</dt>
                  <dd className="font-bold text-navy">{row.avgAmpsPerCustomer.toFixed(1)} Amps</dd>
                </div>
              </dl>
              <p className="mt-2 text-[13px] font-semibold text-navy">
                Recommendation: {row.recommendation}
              </p>
            </div>
          );
        })}

        {/* --- Neutral ------------------------------------------------------ */}
        <div className="bg-surface-2 p-5">
          <p className="text-sm font-extrabold text-[#1c1f1f]">
            {NEUTRAL_META.dot} NEUTRAL — {neutral.amps.toFixed(0)} Amps · {neutral.pctRated.toFixed(0)}% of rated
          </p>
          <p className="mt-1.5 text-xs text-ink-soft">
            Expected: near zero for a balanced three-phase load.
          </p>
          <p className="mt-0.5 text-xs font-semibold text-navy">
            Actual: {neutral.pctRated.toFixed(0)}%
            {neutral.pctRated >= 50
              ? " indicates severe imbalance and possible harmonic content."
              : neutral.pctRated >= 20
                ? " is higher than a balanced load would carry — some imbalance is present."
                : " is close to what a balanced load would carry."}
          </p>
        </div>
      </div>
    </div>
  );
}

const KVA_HINT = "kVA ÷ 0.8 kVA per customer";
