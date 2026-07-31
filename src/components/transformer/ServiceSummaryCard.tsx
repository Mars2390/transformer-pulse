import { formatKes } from "@/lib/format";
import type { ServiceSummary } from "@/lib/service-summary";

/** Every time and cost metric about a transformer's working life, in one place. */
export function ServiceSummaryCard({ summary }: { summary: ServiceSummary }) {
  const { age, ageSource, daysInService, daysInRepair, daysAwaitingAction } = summary;

  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <p className="text-[11px] font-bold tracking-wide text-ink-soft">📊 SERVICE SUMMARY</p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Age" value={`${age.years}y ${age.months}m ${age.days}d`} hint={`from ${ageSource}`} />
        <Metric label="Days in service" value={daysInService != null ? String(daysInService) : "—"} hint="installation → today" />
        <Metric label="Days in repair" value={String(daysInRepair)} hint="sum of all workshop visits" />
        <Metric label="Days awaiting action" value={String(daysAwaitingAction)} hint="time flagged awaiting replacement" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
        <Metric label="Total events" value={String(summary.totalEvents)} />
        <Metric label="Inspections completed" value={String(summary.inspectionsCompleted)} />
        <Metric label="Tests performed" value={String(summary.testsPerformed)} />
        <Metric label="Faults reported" value={String(summary.faultsReported)} />
        <Metric label="Repairs completed" value={String(summary.repairsCompleted)} />
        <Metric label="Warranty claims filed" value={String(summary.warrantyClaimsFiled)} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-3">
        <Metric label="Purchase cost" value={formatKes(summary.purchaseCostKes)} hint="indicative, by rating" />
        <Metric label="Repair cost to date" value={formatKes(summary.repairCostKes)} />
        <Metric
          label="Current loss-of-life cost"
          value={summary.lossOfLifeCostKesPerHour != null ? `${formatKes(summary.lossOfLifeCostKesPerHour)}/hr` : "—"}
          hint={summary.lossOfLifeCostKesPerHour != null ? "from latest load data" : "no load data yet"}
        />
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-navy">{value}</p>
      {hint && <p className="text-[10px] text-ink-soft">{hint}</p>}
    </div>
  );
}
