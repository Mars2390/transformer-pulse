"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * What an engineer does with a finding.
 *
 * A load analysis that ends in a conclusion is a report. One that ends in a
 * raised request is a system. The two actions here are the two real responses
 * to a sustained overload: rebalance the phases, which is a crew task, or
 * uprate the transformer, which needs an asset and therefore an approval.
 */

const NEXT_SIZE: Record<number, number> = {
  50: 100, 100: 200, 200: 315, 315: 500, 500: 630, 630: 1000,
};

export function LoadAnalysisActions({
  datasetId,
  transformerId,
  gNumber,
  siteName,
  substationCode,
  region,
  ratingKva,
  peakPhasePct,
  unbalancePct,
  severity,
}: {
  datasetId: string;
  transformerId: string | null;
  gNumber: string | null;
  siteName: string | null;
  substationCode: string | null;
  region: string | null;
  ratingKva: number;
  peakPhasePct: number;
  unbalancePct: number;
  severity: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; stockTotal: number } | null>(null);
  const [customers, setCustomers] = useState("");

  const suggested = NEXT_SIZE[ratingKva] ?? ratingKva;
  const label = gNumber ? `G-${gNumber}` : (substationCode ?? "this transformer");

  async function raise() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/supply-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteName: siteName ?? `Substation ${substationCode ?? "unknown"}`,
        substationCode: substationCode ?? undefined,
        region: region ?? undefined,
        ratingKvaNeeded: suggested,
        reason: "CAPACITY_UPGRADE",
        failedTransformerId: transformerId ?? undefined,
        customersAffected: customers ? Number(customers) : undefined,
        urgency: peakPhasePct >= 100 ? "HIGH" : "NORMAL",
        notes:
          `Raised from load analysis. ${label} is a ${ratingKva} kVA unit reaching ` +
          `${peakPhasePct.toFixed(0)}% of rated phase current with ${unbalancePct.toFixed(0)}% unbalance. ` +
          `Rebalancing should be attempted first; this request covers the case where it is not enough.`,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(d.error ?? "That did not save."); return; }
    setDone({ reference: d.request.reference, stockTotal: d.stock?.total ?? 0 });
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-kplc/30 bg-kplc/5 p-5">
        <p className="text-sm font-bold text-navy">
          ✅ Supply request {done.reference} raised
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          {done.stockTotal > 0
            ? `${done.stockTotal} × ${suggested} kVA currently free. Awaiting a manager's approval before one can be reserved.`
            : `No free ${suggested} kVA unit — procurement will be needed. Awaiting a manager's approval.`}
        </p>
        <p className="mt-2 text-[11px] text-ink-soft">
          Raising a request does not commit an asset. A manager approves it, and only then can a
          specific transformer be reserved against this site.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <p className="text-[11px] font-bold tracking-[0.1em] text-ink-soft">WHAT TO DO ABOUT IT</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* --- The cheap fix, first ---------------------------------------- */}
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm font-bold text-navy">1 · Rebalance the phases</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            {unbalancePct >= 10
              ? `At ${unbalancePct.toFixed(0)}% unbalance this is the cheapest intervention available and should be tried before anything is bought. Moving single-phase customers between phases costs a crew visit.`
              : "Unbalance is within limits, so rebalancing alone will not fix this."}
          </p>
          {transformerId && (
            <Link
              href={`/transformers/${transformerId}`}
              className="mt-3 inline-block rounded-lg border border-line bg-white px-3 py-2 text-[11px] font-bold text-navy hover:border-kplc"
            >
              Open the record →
            </Link>
          )}
        </div>

        {/* --- The expensive fix ------------------------------------------- */}
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm font-bold text-navy">2 · Uprate to {suggested} kVA</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            {peakPhasePct >= 100
              ? `A phase is reaching ${peakPhasePct.toFixed(0)}% of rated. If rebalancing does not bring it down, this site needs a bigger unit.`
              : "Load is inside rating. An upgrade is not indicated yet."}
          </p>

          {!open ? (
            <button
              onClick={() => setOpen(true)}
              disabled={severity === "OK"}
              className="mt-3 rounded-lg bg-kplc px-3 py-2 text-[11px] font-bold text-white hover:bg-kplc-dark disabled:opacity-40"
            >
              Raise a supply request
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="text-[10px] font-bold text-navy">Customers affected (optional)</span>
                <input
                  inputMode="numeric"
                  value={customers}
                  onChange={(e) => setCustomers(e.target.value)}
                  placeholder="e.g. 400"
                  className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-kplc"
                />
                <span className="mt-0.5 block text-[10px] text-ink-soft">
                  This is what orders the queue. 400 households outrank 6.
                </span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={raise}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-kplc px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                >
                  {busy ? "Raising…" : `Request ${suggested} kVA`}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-line px-3 py-2 text-[11px] font-bold text-navy"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <a
          href={`/api/pdf/control-report?dataset=${datasetId}`}
          className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
        >
          Export PDF
        </a>
        <Link
          href={`/kplc-control?dataset=${datasetId}`}
          className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
        >
          Replay in the control centre
        </Link>
        <Link
          href="/manager/priority"
          className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
        >
          Repair priority
        </Link>
      </div>
    </div>
  );
}
