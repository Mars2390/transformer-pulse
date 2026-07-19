import { formatKes } from "@/lib/format";
import { assessRepairCost, REPEAT_REPAIR_LIMIT } from "@/lib/repair-economics";

/**
 * A transformer's time in workshops.
 *
 * The table is the record, but the two numbers above it are the argument: what
 * this asset has cost to keep alive, and how that compares to replacing it.
 * A unit that has swallowed 80% of a new transformer across three visits is not
 * a maintenance problem, it is a procurement decision that nobody has made yet.
 */

export type RepairView = {
  id: string;
  receivedAtWorkshop: string;
  repairCompletedAt: string | null;
  workshopName: string | null;
  faultCauseReported: string | null;
  faultCauseConfirmed: string | null;
  repairActions: string | null;
  partsReplaced: string | null;
  repairCostKes: number | null;
  repairWarrantyMonths: number | null;
  repairSuccessful: boolean | null;
  failureReason: string | null;
  workshopTechnician: string | null;
  turnaroundDays: number | null;
};

export function RepairsTab({
  repairs,
  ratingKva,
  repairCount,
}: {
  repairs: RepairView[];
  ratingKva: number;
  repairCount: number;
}) {
  if (!repairs.length) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-3xl">🔧</p>
        <p className="mt-3 text-sm font-bold text-navy">Never been to a workshop</p>
        <p className="mt-1 text-xs text-ink-soft">
          This transformer has no repair history on record.
        </p>
      </div>
    );
  }

  const totalSpent = repairs.reduce((s, r) => s + (r.repairCostKes ?? 0), 0);
  const economics = totalSpent > 0 ? assessRepairCost(totalSpent, ratingKva) : null;
  const failed = repairs.filter((r) => r.repairSuccessful === false).length;
  const open = repairs.filter((r) => r.repairCompletedAt == null).length;

  const avgTurnaround = (() => {
    const done = repairs.filter((r) => r.turnaroundDays != null);
    if (!done.length) return null;
    return Math.round(done.reduce((s, r) => s + (r.turnaroundDays ?? 0), 0) / done.length);
  })();

  return (
    <div className="space-y-5 p-5">
      {/* --- The argument --------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Workshop visits"
          value={String(repairs.length)}
          tone={repairs.length >= REPEAT_REPAIR_LIMIT ? "bad" : repairs.length >= 2 ? "warn" : "plain"}
          hint={open ? `${open} still open` : failed ? `${failed} condemned` : "all completed"}
        />
        <Stat
          label="Spent on repairs"
          value={formatKes(totalSpent)}
          tone={economics?.uneconomic ? "bad" : "plain"}
          hint={economics ? `${Math.round(economics.ratio * 100)}% of a new ${ratingKva} kVA` : undefined}
        />
        <Stat
          label="Average turnaround"
          value={avgTurnaround != null ? `${avgTurnaround} days` : "—"}
          tone={avgTurnaround != null && avgTurnaround > 21 ? "warn" : "plain"}
          hint="days a site was without supply"
        />
      </div>

      {repairs.length >= REPEAT_REPAIR_LIMIT && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          <strong>⚠ {repairs.length} workshop visits.</strong> A transformer failing this often is
          usually telling you something about its SITE — load, earthing, or lightning exposure — that
          no single repair record can. Worth checking the load analysis and the last inspection
          before spending on it again.
        </p>
      )}

      {economics?.uneconomic && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          <strong>Cumulative repair spend has passed {Math.round(economics.ratio * 100)}% of a new unit.</strong>{" "}
          {economics.message.split(". ").slice(1).join(". ")}
          <span className="mt-1 block text-[11px] opacity-80">
            Replacement price is indicative, not a quotation.
          </span>
        </p>
      )}

      {/* --- History --------------------------------------------------------- */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
            <tr>
              <th className="px-3 py-2">Received</th>
              <th className="px-3 py-2">Confirmed fault</th>
              <th className="px-3 py-2">Work done</th>
              <th className="px-3 py-2">Cost</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {repairs.map((r) => (
              <tr key={r.id} className={r.repairSuccessful === false ? "bg-red-50/40" : undefined}>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="font-semibold text-navy">{r.receivedAtWorkshop}</span>
                  {r.workshopName && (
                    <span className="block text-[10px] text-ink-soft">{r.workshopName}</span>
                  )}
                </td>
                <td className="max-w-[190px] px-3 py-2">
                  <span className="text-navy">{r.faultCauseConfirmed ?? "—"}</span>
                  {/* The correction is the useful part: what the field reported
                      is often not what the workshop found. */}
                  {r.faultCauseReported && r.faultCauseReported !== r.faultCauseConfirmed && (
                    <span className="block text-[10px] text-ink-soft">
                      reported as &ldquo;{r.faultCauseReported}&rdquo;
                    </span>
                  )}
                </td>
                <td className="max-w-[220px] px-3 py-2 text-ink-soft">
                  {r.repairActions ?? "—"}
                  {r.partsReplaced && (
                    <span className="block text-[10px]">Parts: {r.partsReplaced}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold text-navy">
                  {r.repairCostKes != null ? formatKes(r.repairCostKes) : "—"}
                </td>
                <td className="px-3 py-2">{r.turnaroundDays ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.repairCompletedAt == null ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                      on the bench
                    </span>
                  ) : r.repairSuccessful ? (
                    <>
                      <span className="rounded bg-kplc/10 px-1.5 py-0.5 text-[10px] font-bold text-kplc">
                        repaired
                      </span>
                      {r.repairWarrantyMonths ? (
                        <span className="block text-[10px] text-ink-soft">
                          {r.repairWarrantyMonths} month workshop warranty
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                        beyond repair
                      </span>
                      {r.failureReason && (
                        <span className="block text-[10px] text-red-800">{r.failureReason}</span>
                      )}
                    </>
                  )}
                  {r.workshopTechnician && (
                    <span className="block text-[10px] text-ink-soft">{r.workshopTechnician}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-soft">
        A repaired unit carries a <strong className="text-navy">workshop</strong> warranty, not the
        manufacturer&apos;s. If it fails inside that window the rework is the workshop&apos;s — which
        is only arguable because the distinction is recorded here.
        {repairCount !== repairs.length && (
          <> The cached repair count is {repairCount}; {repairs.length} records are held.</>
        )}
      </p>
    </div>
  );
}

function Stat({
  label, value, hint, tone,
}: { label: string; value: string; hint?: string; tone: "plain" | "warn" | "bad" }) {
  const c = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-navy";
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-[11px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className={`mt-1 text-2xl font-extrabold ${c}`}>{value}</p>
      {hint && <p className="text-[10px] text-ink-soft">{hint}</p>}
    </div>
  );
}
