import type { SmartSummary, TrendDirection } from "@/lib/data-timeline";

const DIRECTION: Record<TrendDirection, { icon: string; label: string; className: string }> = {
  IMPROVING: { icon: "📉", label: "improving", className: "text-kplc" },
  WORSENING: { icon: "📈", label: "worsening", className: "text-red-700" },
  STABLE: { icon: "➡️", label: "stable", className: "text-navy" },
  UNKNOWN: { icon: "—", label: "not established", className: "text-ink-soft" },
};

/**
 * The answer before the evidence.
 *
 * A manager opening a transformer's page wants to know whether it is getting
 * better or worse and what to do about it. Everything needed to answer that is
 * already on the page, spread across four tabs and several hundred readings,
 * which in practice means nobody answers it. This card states the conclusion
 * and shows the numbers it came from, so it can be checked rather than trusted.
 */
export function SmartSummaryCard({
  label,
  summary,
}: {
  label: string;
  summary: SmartSummary;
}) {
  const { trend, inspectionTrend } = summary;
  const dir = DIRECTION[trend.direction];
  const inspDir = DIRECTION[inspectionTrend.direction];

  const nothingRecorded =
    summary.emdisCount === 0 && summary.inspectionCount === 0 && summary.repairCount === 0;

  if (nothingRecorded) {
    return (
      <div className="rounded-2xl border border-line bg-surface-2 px-5 py-4">
        <p className="text-sm font-bold text-navy">{label} — no time-series data yet</p>
        <p className="mt-1 text-xs text-ink-soft">
          No EMDis load export, no inspection and no workshop visit is on record for this unit.
          Its history begins when the first of those arrives.
        </p>
      </div>
    );
  }

  const counts = [
    summary.emdisCount > 0
      ? `📊 ${summary.emdisCount} EMDis dataset${summary.emdisCount === 1 ? "" : "s"} (${uniqueMonths(summary.emdisMonths)})`
      : null,
    summary.inspectionCount > 0
      ? `📋 ${summary.inspectionCount} KYN inspection${summary.inspectionCount === 1 ? "" : "s"} (${uniqueMonths(summary.inspectionMonths)})`
      : null,
    summary.repairCount > 0
      ? `🔧 ${summary.repairCount} workshop visit${summary.repairCount === 1 ? "" : "s"} (${uniqueMonths(summary.repairMonths)})`
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-navy/15 bg-white">
      <div className="border-b border-line bg-navy px-5 py-3">
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-white/70">HEALTH OVERVIEW</p>
        <p className="text-lg font-extrabold text-white">{label}</p>
      </div>

      <div className="grid gap-5 px-5 py-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-extrabold tracking-[0.08em] text-ink-soft">ON RECORD</p>
          <ul className="mt-2 space-y-1">
            {counts.map((c) => (
              <li key={c} className="text-sm text-ink">{c}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-extrabold tracking-[0.08em] text-ink-soft">TREND</p>
          {trend.periods.length >= 2 && trend.series ? (
            <>
              <p className={`mt-2 text-sm font-bold ${dir.className}`}>
                {dir.icon} Peak phase {dir.label}
              </p>
              <p className="mt-0.5 font-mono text-sm text-navy">{trend.series}</p>
              {trend.changePoints != null && (
                <p className="mt-0.5 text-xs text-ink-soft">
                  {trend.changePoints > 0 ? "+" : ""}
                  {trend.changePoints} points across {trend.periods.length} periods
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">
              {trend.periods.length === 1
                ? "One period on record — a trend needs at least two."
                : "No load telemetry yet."}
            </p>
          )}

          {inspectionTrend.points.length >= 2 && (
            <p className={`mt-2 text-xs font-semibold ${inspDir.className}`}>
              Physical condition {inspDir.label} across {inspectionTrend.points.length} inspections
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-line bg-surface-2 px-5 py-3.5">
        <p className="text-sm font-semibold text-navy">
          <span className="text-[11px] font-extrabold tracking-[0.08em] text-ink-soft">LATEST </span>
          {trend.verdict}
        </p>
        <p className="text-sm text-ink">
          <span className="text-[11px] font-extrabold tracking-[0.08em] text-ink-soft">NEXT ACTION </span>
          {trend.nextAction}
        </p>
        {inspectionTrend.changes.length > 0 && (
          <p className="text-xs text-amber-800">
            <span className="text-[11px] font-extrabold tracking-[0.08em]">CHANGED </span>
            {inspectionTrend.changes[0]}
          </p>
        )}
      </div>
    </div>
  );
}

/** "Dec, Jan, Feb" — repeated months collapse, because three uploads in one month is one month. */
function uniqueMonths(months: string[]): string {
  const seen: string[] = [];
  for (const m of months) {
    const short = m.split(" ")[0];
    if (!seen.includes(short)) seen.push(short);
  }
  return seen.join(", ");
}
