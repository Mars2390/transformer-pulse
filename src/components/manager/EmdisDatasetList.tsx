"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";

/**
 * The load datasets the analysis is reading from, and the controls for taking
 * one back out.
 *
 * Deletion is stated in full before it happens — how many readings go, how many
 * alerts are withdrawn with them, and that the transformer will be rescored.
 * A confirmation that says only "are you sure?" is not a confirmation; it is a
 * speed bump, and people learn to click through it without reading.
 */

type Dataset = {
  id: string;
  name: string;
  transformerId: string | null;
  transformerLabel: string | null;
  transformerRatingKva: number | null;
  substationCode: string | null;
  serialAsRecorded: string | null;
  ratingKvaAsRecorded: number | null;
  resolvedBy: string;
  firstReadingAt: string;
  lastReadingAt: string;
  readingCount: number;
  intervalSeconds: number;
  uploadedByName: string;
  createdAt: string;
  staged: boolean;
  stagingReason: string | null;
  duplicateKind: string | null;
  duplicateOf: { id: string; name: string } | null;
  alertCount: number;
};

type ScanTotals = {
  datasets: number;
  identical: number;
  sameRange: number;
  overlap: number;
  redundantReadings: number;
  /** Alert rows that say exactly the same thing about the same transformer. */
  redundantAlerts: number;
};

const DUPLICATE_LABEL: Record<string, string> = {
  IDENTICAL: "Exact duplicate",
  SAME_RANGE: "Same window, different values",
  OVERLAP: "Overlapping window",
};

export function EmdisDatasetList({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanTotals | null>(null);
  const [confirming, setConfirming] = useState<Dataset | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [clearPhrase, setClearPhrase] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/emdis/datasets");
    const data = await res.json().catch(() => ({}));
    setDatasets(data.datasets ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runScan() {
    setBusy("scan"); setError(null); setNote(null);
    const res = await fetch("/api/emdis/datasets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "scan" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "The scan could not run."); return; }
    setScan(data.totals);
    const flagged = data.totals.identical + data.totals.sameRange + data.totals.overlap;
    setNote(
      (flagged === 0
        ? `Scanned ${data.totals.datasets} dataset(s). No duplicates — every reading in the system is counted once.`
        : `Scanned ${data.totals.datasets} dataset(s): ${data.totals.identical} exact duplicate(s), ` +
          `${data.totals.sameRange} same-window, ${data.totals.overlap} overlapping. ` +
          `${data.totals.redundantReadings.toLocaleString()} readings are being counted twice.`) +
      (data.totals.redundantAlerts
        ? ` ${data.totals.redundantAlerts} alert row(s) repeat a finding word for word.`
        : ""),
    );
    await load();
    router.refresh();
  }

  async function collapseAlerts() {
    setBusy("alerts"); setError(null); setNote(null);
    const res = await fetch("/api/emdis/datasets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "collapse-alerts" }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "The alerts could not be collapsed."); return; }
    setNote(
      `Removed ${data.removed} repeated alert row(s) across ${data.groups} finding(s). ` +
      `One copy of each finding was kept — no finding was lost.`,
    );
    setScan((prev) => (prev ? { ...prev, redundantAlerts: 0 } : prev));
    await load();
    router.refresh();
  }

  async function remove(d: Dataset) {
    setBusy(d.id); setError(null); setNote(null);
    const res = await fetch(`/api/emdis/datasets?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(null); setConfirming(null);
    if (!res.ok) { setError(data.error ?? "That dataset could not be deleted."); return; }
    setNote(
      `Deleted “${d.name}”: ${data.readingsRemoved.toLocaleString()} readings removed, ` +
      `${data.alertsWithdrawn} alert(s) withdrawn` +
      (data.rescored?.length
        ? `, ${data.rescored.map((r: { label: string; level: string }) => `${r.label} now ${r.level}`).join(", ")}.`
        : "."),
    );
    await load();
    router.refresh();
  }

  async function clearAll() {
    setBusy("all"); setError(null); setNote(null);
    const res = await fetch("/api/emdis/datasets?all=1", { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(null); setClearingAll(false); setClearPhrase("");
    if (!res.ok) { setError(data.error ?? "The load data could not be cleared."); return; }
    setNote(
      `Cleared ${data.deleted} dataset(s): ${data.readingsRemoved.toLocaleString()} readings removed, ` +
      `${data.alertsWithdrawn} alert(s) withdrawn, ${data.rescored?.length ?? 0} transformer(s) rescored.`,
    );
    await load();
    router.refresh();
  }

  const flagged = datasets.filter((d) => d.duplicateKind);
  const redundant = flagged
    .filter((d) => d.duplicateKind === "IDENTICAL" || d.duplicateKind === "SAME_RANGE")
    .reduce((s, d) => s + d.readingCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-5 py-3">
        <h2 className="text-sm font-bold text-navy">
          Datasets{" "}
          <span className="font-normal text-ink-soft">
            ({datasets.length}, {datasets.reduce((s, d) => s + d.readingCount, 0).toLocaleString()} readings)
          </span>
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={runScan}
            disabled={busy !== null}
            className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc disabled:opacity-50"
          >
            {busy === "scan" ? "Scanning…" : "Scan for duplicates"}
          </button>
          {isAdmin && datasets.length > 0 && (
            <button
              onClick={() => setClearingAll(true)}
              disabled={busy !== null}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}
      {note && (
        <p className="rounded-lg border border-kplc/30 bg-kplc/5 px-4 py-3 text-sm font-semibold text-navy">
          {note}
        </p>
      )}

      {flagged.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-bold text-amber-900">
            ⚠️ {flagged.length} dataset{flagged.length === 1 ? " is" : "s are"} flagged as duplicate
          </p>
          <p className="mt-1 text-xs text-amber-900">
            {redundant > 0 ? (
              <>
                {redundant.toLocaleString()} readings are counted twice. Every figure built by adding up —
                minutes spent over rated current, total readings held — is inflated for the affected
                transformers until the copies are deleted. Peaks and averages are unaffected.
              </>
            ) : (
              <>
                These overlap in time with data already held. Overlapping windows double-count the
                minutes spent over rated current for the hours they share.
              </>
            )}
          </p>
        </div>
      )}

      {scan && scan.redundantAlerts > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-amber-900">
              ⚠️ {scan.redundantAlerts} alert row{scan.redundantAlerts === 1 ? "" : "s"} repeat a finding
              word for word
            </p>
            <p className="mt-1 text-xs text-amber-900">
              The same defect raised more than once on the same transformer, from data that was
              imported twice. Collapsing keeps one copy of each finding — an acknowledged one where
              there is one, so nobody&apos;s sign-off is thrown away.
            </p>
          </div>
          <button
            onClick={collapseAlerts}
            disabled={busy !== null}
            className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {busy === "alerts" ? "Collapsing…" : "Collapse repeats"}
          </button>
        </div>
      )}

      {scan && scan.datasets > 0 && flagged.length === 0 && scan.redundantAlerts === 0 && (
        <p className="rounded-lg border border-kplc/30 bg-kplc/5 px-4 py-3 text-xs font-semibold text-navy">
          ✅ Every reading in the system is counted exactly once.
        </p>
      )}

      {loading ? (
        <p className="px-5 py-6 text-sm text-ink-soft">Loading datasets…</p>
      ) : datasets.length === 0 ? (
        <p className="rounded-2xl border border-line bg-white px-5 py-8 text-center text-sm text-ink-soft">
          No load data yet. Upload an EMDis export or a column table above.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <ul className="divide-y divide-line">
            {datasets.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-navy">
                    {d.transformerLabel ? `G-${d.transformerLabel}` : d.substationCode ?? d.name}
                    {d.transformerRatingKva ? (
                      <span className="font-normal text-ink-soft">{d.transformerRatingKva} kVA</span>
                    ) : null}
                    {d.duplicateKind ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                        {DUPLICATE_LABEL[d.duplicateKind] ?? d.duplicateKind}
                      </span>
                    ) : !d.transformerId ? (
                      <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-bold text-ink-soft">
                        Unattached — counts toward no transformer
                      </span>
                    ) : (
                      <span className="rounded-full bg-kplc/10 px-2.5 py-0.5 text-[11px] font-bold text-kplc">
                        In the analysis
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    {d.name} · {d.readingCount.toLocaleString()} readings at {d.intervalSeconds}s ·{" "}
                    {d.firstReadingAt.slice(0, 10)} to {d.lastReadingAt.slice(0, 10)} ·{" "}
                    {d.uploadedByName}
                    {d.alertCount > 0 && ` · ${d.alertCount} alert${d.alertCount === 1 ? "" : "s"}`}
                  </p>
                  {d.duplicateOf && (
                    <p className="mt-0.5 text-[11px] font-semibold text-amber-800">
                      Duplicate of “{d.duplicateOf.name}” — that copy came first and is the one to keep.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/manager/load-analysis/${d.id}`}
                    className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark"
                  >
                    Load analysis
                  </Link>
                  <Link
                    href={`/kplc-control?dataset=${d.id}`}
                    className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
                  >
                    Control centre
                  </Link>
                  <button
                    onClick={() => setConfirming(d)}
                    disabled={busy !== null}
                    className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === d.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title="Delete this dataset?">
        {confirming && (
          <div className="space-y-3 text-sm">
            <p className="font-bold text-navy">{confirming.name}</p>
            <ul className="space-y-1 rounded-lg bg-surface-2 px-4 py-3 text-xs text-ink-soft">
              <li>
                <strong className="text-navy">{confirming.readingCount.toLocaleString()}</strong> readings and
                their hourly rollups are removed.
              </li>
              <li>
                {confirming.alertCount > 0 ? (
                  <>
                    <strong className="text-navy">{confirming.alertCount}</strong> alert
                    {confirming.alertCount === 1 ? "" : "s"} raised from this data{" "}
                    {confirming.alertCount === 1 ? "is" : "are"} withdrawn with it.
                  </>
                ) : (
                  <>
                    No alert is <strong className="text-navy">linked</strong> to this dataset. Alerts
                    raised before uploads recorded which data they came from are not linked to any
                    dataset and will survive this deletion — the duplicate scan lists any that repeat.
                  </>
                )}
              </li>
              {confirming.transformerLabel && (
                <li>
                  <strong className="text-navy">G-{confirming.transformerLabel}</strong> is rescored
                  immediately, so its health reflects only the data that remains.
                </li>
              )}
              <li>
                The load check on the transformer&apos;s lifecycle chain stays. The chain is
                append-only and hash-linked — a check did happen on that day, and that is still true.
              </li>
            </ul>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => remove(confirming)}
                disabled={busy !== null}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete dataset
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-bold text-navy"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={clearingAll} onClose={() => { setClearingAll(false); setClearPhrase(""); }} title="Clear ALL load data?">
        <div className="space-y-3 text-sm">
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">
            This removes every load dataset in the system —{" "}
            {datasets.length} dataset{datasets.length === 1 ? "" : "s"},{" "}
            {datasets.reduce((s, d) => s + d.readingCount, 0).toLocaleString()} readings, and{" "}
            {datasets.reduce((s, d) => s + d.alertCount, 0)} alert
            {datasets.reduce((s, d) => s + d.alertCount, 0) === 1 ? "" : "s"} raised from them. Every
            affected transformer loses its electrical health score until new data is uploaded. It
            cannot be undone from this screen.
          </p>
          <label className="block">
            <span className="text-xs font-bold text-navy">
              Type CLEAR ALL to confirm
            </span>
            <input
              value={clearPhrase}
              onChange={(e) => setClearPhrase(e.target.value)}
              placeholder="CLEAR ALL"
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              onClick={clearAll}
              disabled={clearPhrase.trim().toUpperCase() !== "CLEAR ALL" || busy !== null}
              className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
            >
              {busy === "all" ? "Clearing…" : "Clear all load data"}
            </button>
            <button
              onClick={() => { setClearingAll(false); setClearPhrase(""); }}
              className="rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-bold text-navy"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
