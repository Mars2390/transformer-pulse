import { formatKes } from "@/lib/format";
import type { BalancePlan, Capacity, LifePrognosis, LossOfLifeMoney, WhatIfResult, VoltageScorecard } from "@/lib/load-balancing";

/**
 * The load-balancing plan, rendered as a work instruction rather than a chart.
 *
 * Everything here is a recommendation with its arithmetic on show. Nothing is
 * an automatic action — the panel ends with the two buttons an engineer uses to
 * take it forward, and the decision is theirs.
 */
export function LoadBalancingPanel({
  gNumber,
  ratingKva,
  balance,
  capacity,
  prognosis,
  money,
  whatIfBalance,
  whatIfUprate,
  scorecard,
  customerAmps,
}: {
  gNumber: string | null;
  ratingKva: number;
  balance: BalancePlan;
  capacity: Capacity;
  prognosis: LifePrognosis;
  money: LossOfLifeMoney;
  whatIfBalance: WhatIfResult | null;
  whatIfUprate: WhatIfResult | null;
  scorecard: VoltageScorecard;
  customerAmps: number;
}) {
  const gradeColour: Record<string, string> = {
    A: "text-kplc", B: "text-kplc", C: "text-amber-700", D: "text-amber-700", F: "text-red-700",
  };

  return (
    <div className="space-y-5">
      {/* --- Present vs target --------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">
            ⚖️ Load balancing plan{gNumber ? ` — G-${gNumber}` : ""}
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            At the worst recorded minute. Balancing brings every phase to the mean, which is also the
            coolest the winding can run for that load.
          </p>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-2">
          <div className="bg-white p-5">
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">NOW</p>
            {balance.present.map((p) => (
              <PhaseRow key={p.phase} name={p.phase} amps={p.amps} pct={p.pctRated} target={false} />
            ))}
            <p className="mt-2 text-sm font-bold text-red-700">
              Unbalance {balance.unbalanceBeforePct.toFixed(0)}%
            </p>
          </div>
          <div className="bg-surface-2 p-5">
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">AFTER BALANCING</p>
            {balance.present.map((p) => (
              <PhaseRow key={p.phase} name={p.phase} amps={balance.targetA} pct={balance.targetPctRated} target />
            ))}
            <p className="mt-2 text-sm font-bold text-kplc">
              Unbalance under {balance.unbalanceAfterPct.toFixed(0)}%
            </p>
          </div>
        </div>

        {balance.feasible ? (
          <div className="border-t border-line px-5 py-4">
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">REQUIRED MOVES</p>
            <ul className="mt-2 space-y-1">
              {balance.moves.map((m, i) => (
                <li key={i} className="text-sm font-semibold text-navy">
                  • Move <span className="text-red-700">{m.amps} A</span> from {m.from} → {m.to}
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-lg bg-surface-2 px-4 py-2.5 text-xs text-ink-soft">
              That is <strong className="text-navy">{balance.totalAmpsToMove} A</strong> in total —
              roughly{" "}
              <strong className="text-navy">
                {balance.estimatedMetersToMove} single-phase customers
              </strong>{" "}
              at about {customerAmps} A each. Meter-level phase data would turn this into an exact
              list; without it, start with the largest single-phase loads on the overloaded phase.
            </p>
          </div>
        ) : (
          <p className="border-t border-line px-5 py-4 text-sm text-ink-soft">
            {balance.note}
          </p>
        )}
      </div>

      {/* --- What balancing buys ------------------------------------------- */}
      {whatIfBalance && balance.feasible && (
        <div className="rounded-2xl border-2 border-kplc/30 bg-kplc/5 p-5">
          <p className="text-[11px] font-bold tracking-[0.12em] text-kplc">WHAT BALANCING BUYS YOU</p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Buy label="Hot-spot" value={`−${whatIfBalance.hotspotDropC.toFixed(0)} °C`} sub={`to ${whatIfBalance.newHotspotC.toFixed(0)} °C`} />
            <Buy label="Ageing" value={`${whatIfBalance.ageingImprovement.toFixed(0)}× slower`} sub={`to ${whatIfBalance.newAgeingRate.toFixed(1)}×`} />
            <Buy label="Life restored" value={`${whatIfBalance.newYearsToEndOfLife > 30 ? "30+" : whatIfBalance.newYearsToEndOfLife.toFixed(0)} yr`} sub={`from ${prognosis.yearsToEndOfLife.toFixed(1)} yr`} />
            <Buy label="Cost avoided" value={formatKes(money.currentPerYearKes - money.normalPerYearKes)} sub="per year" />
          </div>
          <p className="mt-3 text-[11px] text-ink-soft">
            No purchase, no outage — a crew reassigns single-phase loads between phases.
          </p>
        </div>
      )}

      {/* --- Capacity ------------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <p className="text-[11px] font-bold tracking-wide text-ink-soft">CAPACITY — {ratingKva} kVA</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Rated per phase" value={`${capacity.ratedPhaseA.toFixed(0)} A`} />
          <Metric label="Peak utilisation" value={`${capacity.utilisationPct.toFixed(0)}%`} bad={capacity.utilisationPct > 100} />
          <Metric
            label="Over on peak phase"
            value={capacity.overloadHeaviestPhaseA > 0 ? `${capacity.overloadHeaviestPhaseA.toFixed(0)} A` : "none"}
            bad={capacity.overloadHeaviestPhaseA > 0}
            sub={capacity.customersToShedFromPeak ? `≈${capacity.customersToShedFromPeak} customers` : undefined}
          />
          <Metric
            label="Spare if balanced"
            value={capacity.spareCustomers != null ? `${capacity.spareCustomers} customers` : "—"}
            sub={`${capacity.headroomLightestPhaseA.toFixed(0)} A on the light phase`}
          />
        </div>
      </div>

      {/* --- Prognosis + money -------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[11px] font-bold tracking-wide text-ink-soft">TIME TO FAILURE</p>
          <p className="mt-2 text-3xl font-extrabold text-red-700">
            {prognosis.yearsToEndOfLife < 1
              ? `${(prognosis.yearsToEndOfLife * 12).toFixed(1)} months`
              : `${prognosis.yearsToEndOfLife.toFixed(1)} years`}
          </p>
          <p className="text-xs text-ink-soft">
            at the average ageing rate of {prognosis.avgAgeingRate.toFixed(1)}× (peak {prognosis.peakAgeingRate.toFixed(0)}×), against a
            30-year design life.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            IEC 60076-7: insulation ages at 2^((θ−98)/6). One hour at the peak hot-spot spends{" "}
            {prognosis.peakAgeingRate.toFixed(0)} hours of life.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[11px] font-bold tracking-wide text-ink-soft">COST OF THE AGEING</p>
          <p className="mt-2 text-3xl font-extrabold text-red-700">
            {formatKes(money.currentPerDayKes)}<span className="text-base font-bold text-ink-soft">/day</span>
          </p>
          <p className="text-xs text-ink-soft">
            in consumed asset life, against {formatKes(money.replacementKes)} to replace.
          </p>
          <dl className="mt-2 space-y-0.5 text-[11px]">
            <Row k="Normal depreciation" v={`${formatKes(money.normalPerYearKes)}/yr`} />
            <Row k="Current depreciation" v={`${formatKes(money.currentPerYearKes)}/yr`} bad />
            <Row k="Per hour, right now" v={`${formatKes(money.currentPerHourKes)}/hr`} bad />
          </dl>
        </div>
      </div>

      {/* --- What-if uprate + scorecard ----------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        {whatIfUprate && (
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">IF REBALANCING IS NOT ENOUGH</p>
            <p className="mt-1 text-sm font-bold text-navy">{whatIfUprate.scenario}</p>
            <dl className="mt-2 space-y-0.5 text-xs">
              <Row k="Hot-spot" v={`${whatIfUprate.newHotspotC.toFixed(0)} °C (−${whatIfUprate.hotspotDropC.toFixed(0)})`} />
              <Row k="Ageing" v={`${whatIfUprate.newAgeingRate.toFixed(1)}×`} />
              <Row k="Life" v={`${whatIfUprate.newYearsToEndOfLife > 30 ? "restored to normal" : whatIfUprate.newYearsToEndOfLife.toFixed(0) + " yr"}`} />
            </dl>
            <p className="mt-2 text-[10px] text-ink-soft">
              A bigger unit is the answer only if the load is genuinely growing past what one
              transformer should carry — balancing is always the first move.
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[11px] font-bold tracking-wide text-ink-soft">POWER-QUALITY GRADE</p>
          <p className={`mt-1 text-5xl font-extrabold ${gradeColour[scorecard.grade]}`}>
            {scorecard.grade}
            <span className="ml-2 align-middle text-lg font-bold text-ink-soft">{scorecard.score}/100</span>
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 text-[11px]">
            <Row k="Voltage" v={`${scorecard.breakdown.voltage}/40`} />
            <Row k="Harmonics" v={`${scorecard.breakdown.thd}/30`} />
            <Row k="Frequency" v={`${scorecard.breakdown.frequency}/15`} />
            <Row k="Balance" v={`${scorecard.breakdown.unbalance}/15`} />
          </dl>
          {scorecard.notes.length > 0 && (
            <p className="mt-2 text-[10px] leading-snug text-ink-soft">{scorecard.notes[0]}</p>
          )}
        </div>
      </div>

      <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
        Every figure here is a <strong className="text-navy">recommendation with its arithmetic shown</strong>,
        not an instruction. Balancing is a crew reassigning loads; the system never moves anything itself, and
        the engineer has the final say. Customer counts assume about {customerAmps} A per connection and are
        explicitly approximate until meter-level data is loaded.
      </p>
    </div>
  );
}

function PhaseRow({ name, amps, pct, target }: { name: string; amps: number; pct: number; target: boolean }) {
  const colour = pct >= 100 ? "#dc2626" : pct >= 80 ? "#d97706" : "#0e8a4f";
  return (
    <div className="mt-2 first:mt-3">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold" style={{ color: target ? "#0e8a4f" : colour }}>{name}</span>
        <span className="font-mono tabular-nums" style={{ color: target ? "#0e8a4f" : colour }}>
          {amps.toFixed(0)} A · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded bg-black/5">
        <div className="h-full rounded" style={{ width: `${Math.min(100, pct / 1.4)}%`, backgroundColor: target ? "#0e8a4f" : colour }} />
      </div>
    </div>
  );
}

function Buy({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className="text-lg font-extrabold text-kplc">{value}</p>
      <p className="text-[10px] text-ink-soft">{sub}</p>
    </div>
  );
}

function Metric({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className={`text-lg font-extrabold ${bad ? "text-red-700" : "text-navy"}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink-soft">{sub}</p>}
    </div>
  );
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-soft">{k}</dt>
      <dd className={`font-bold ${bad ? "text-red-700" : "text-navy"}`}>{v}</dd>
    </div>
  );
}
