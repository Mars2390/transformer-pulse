/**
 * Whether this transformer's load telemetry (EMDis) and inspection register
 * (KYN) records are actually linked to it — not just present somewhere in the
 * database. A dataset that failed to match sits staged and invisible unless
 * this says so.
 */
export function LinkStatusBanner({
  emdisReadingCount,
  inspectionCount,
}: {
  emdisReadingCount: number;
  inspectionCount: number;
}) {
  const hasEmdis = emdisReadingCount > 0;
  const hasKyn = inspectionCount > 0;

  if (hasEmdis && hasKyn) {
    return (
      <p className="rounded-lg border border-kplc/30 bg-kplc/5 px-4 py-2.5 text-xs font-semibold text-kplc">
        ✅ EMDis + KYN linked — {emdisReadingCount.toLocaleString()} load reading{emdisReadingCount === 1 ? "" : "s"}{" "}
        matched to {inspectionCount} inspection record{inspectionCount === 1 ? "" : "s"}
      </p>
    );
  }
  if (hasKyn && !hasEmdis) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">
        ⚠️ KYN data available but no EMDis link — upload load data
      </p>
    );
  }
  if (hasEmdis && !hasKyn) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800">
        ⚠️ EMDis data available but no KYN link — upload inspection records
      </p>
    );
  }
  return (
    <p className="rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-xs text-ink-soft">
      No EMDis load data or KYN inspection records linked to this transformer yet.
    </p>
  );
}
