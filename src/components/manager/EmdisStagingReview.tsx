"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * The staging queue for load data whose transformer could not be identified.
 *
 * Two decisions, and only two: say which transformer this is, or discard it.
 * There is deliberately no "import it unattached anyway" — that was the old
 * behaviour, and it produced datasets that sat in the register looking like
 * data while contributing to nothing, which is the worst of both.
 */

type Staged = {
  id: string;
  name: string;
  substationCode: string | null;
  serialAsRecorded: string | null;
  ratingKvaAsRecorded: number | null;
  firstReadingAt: string;
  lastReadingAt: string;
  readingCount: number;
  intervalSeconds: number;
  uploadedByName: string;
  createdAt: string;
  stagingReason: string | null;
  duplicateKind: string | null;
};

type Hit = { id: string; label: string; detail: string };

export function EmdisStagingReview() {
  const router = useRouter();
  const [rows, setRows] = useState<Staged[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** Per-row transformer search, keyed by dataset id. */
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [chosen, setChosen] = useState<Hit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/emdis/staging");
    const data = await res.json().catch(() => ({}));
    setRows(data.datasets ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function startMatching(id: string, row: Staged) {
    setOpenFor(id);
    setChosen(null);
    setHits([]);
    // Seed the search with what the file said about itself. It is usually the
    // right query, and retyping a serial off the screen above is busywork.
    const seed = row.serialAsRecorded ?? row.substationCode ?? "";
    setQuery(seed);
    if (seed.trim().length >= 2) void search(seed);
  }

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setHits([]); return; }
    const res = await fetch(`/api/transformers/search?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({ results: [] }));
    setHits(data.results ?? []);
  }

  async function approve(row: Staged) {
    if (!chosen) return;
    setBusy(row.id); setError(null); setNote(null);
    const res = await fetch("/api/emdis/staging", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datasetId: row.id, transformerId: chosen.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "That dataset could not be approved."); return; }

    setOpenFor(null); setChosen(null); setQuery(""); setHits([]);
    setNote(
      `Approved onto ${data.transformerLabel}: ${data.readings.toLocaleString()} readings now count ` +
      `toward its analysis, ${data.alertsRaised} alert${data.alertsRaised === 1 ? "" : "s"} raised` +
      (data.recomputed
        ? `, and every percentage was recomputed against the register's ${data.ratingKva} kVA rating.`
        : ".") +
      (data.health ? ` Health is now ${data.health.level}.` : ""),
    );
    await load();
    router.refresh();
  }

  async function discard(row: Staged) {
    setBusy(row.id); setError(null); setNote(null);
    const res = await fetch(`/api/emdis/staging?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "That dataset could not be discarded."); return; }
    setNote(`Discarded “${row.name}” — ${data.readings.toLocaleString()} readings removed. It never entered the analysis.`);
    await load();
    router.refresh();
  }

  if (loading) {
    return <p className="rounded-2xl border border-line bg-white px-5 py-8 text-sm text-ink-soft">Loading staged load data…</p>;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p>
      )}
      {note && (
        <p className="rounded-lg border border-kplc/30 bg-kplc/5 px-4 py-3 text-sm font-semibold text-navy">{note}</p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-5 py-8 text-center">
          <p className="text-sm font-bold text-navy">Nothing waiting</p>
          <p className="mt-1 text-xs text-ink-soft">
            Every load dataset uploaded so far was matched to a transformer on the register.
          </p>
        </div>
      ) : (
        <>
          <p className="rounded-2xl border border-line bg-white px-5 py-3 text-sm">
            <strong className="text-navy">
              {rows.length} dataset{rows.length === 1 ? "" : "s"} waiting
            </strong>{" "}
            <span className="text-ink-soft">
              · {rows.reduce((s, r) => s + r.readingCount, 0).toLocaleString()} readings held out of the
              analysis
            </span>
          </p>

          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-amber-200 bg-white">
                <div className="flex flex-wrap items-start gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-navy">
                      {r.substationCode ? `Substation ${r.substationCode}` : r.name}
                      {r.serialAsRecorded && (
                        <span className="ml-2 font-normal text-ink-soft">serial {r.serialAsRecorded}</span>
                      )}
                      {r.ratingKvaAsRecorded && (
                        <span className="ml-2 font-normal text-ink-soft">{r.ratingKvaAsRecorded} kVA per the file</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {r.name} · {r.readingCount.toLocaleString()} readings at {r.intervalSeconds}s ·{" "}
                      {r.firstReadingAt.slice(0, 10)} to {r.lastReadingAt.slice(0, 10)} · uploaded by{" "}
                      {r.uploadedByName}
                    </p>
                    {r.stagingReason && (
                      <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        {r.stagingReason}
                      </p>
                    )}
                    {r.duplicateKind && (
                      <p className="mt-1.5 text-xs font-bold text-amber-800">
                        ⚠️ Also flagged as a duplicate of data already held — check before approving.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/manager/load-analysis/${r.id}`}
                      className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
                    >
                      Inspect readings
                    </Link>
                    <button
                      onClick={() => (openFor === r.id ? setOpenFor(null) : startMatching(r.id, r))}
                      disabled={busy !== null}
                      className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
                    >
                      {openFor === r.id ? "Close" : "Match to transformer"}
                    </button>
                    <button
                      onClick={() => discard(r)}
                      disabled={busy !== null}
                      className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === r.id ? "Working…" : "Discard"}
                    </button>
                  </div>
                </div>

                {openFor === r.id && (
                  <div className="space-y-2 border-t border-line bg-surface-2 px-5 py-4">
                    <input
                      value={query}
                      onChange={(e) => search(e.target.value)}
                      placeholder="Search the register by G-Number, serial or site…"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                    />
                    {hits.length > 0 && !chosen && (
                      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
                        {hits.map((h) => (
                          <li key={h.id}>
                            <button
                              onClick={() => { setChosen(h); setHits([]); }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface-2"
                            >
                              <span className="font-bold text-navy">{h.label}</span>
                              <span className="text-ink-soft">{h.detail}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {query.trim().length >= 2 && !hits.length && !chosen && (
                      <p className="text-xs text-ink-soft">
                        Nothing on the register matches that.{" "}
                        <Link href="/store-onboard" className="font-semibold text-kplc underline">
                          Onboard the transformer
                        </Link>{" "}
                        first, then come back — this data will still be here.
                      </p>
                    )}

                    {chosen && (
                      <div className="space-y-2 rounded-lg border border-kplc/30 bg-white px-4 py-3">
                        <p className="text-xs">
                          <span className="font-bold text-kplc">{chosen.label}</span>{" "}
                          <span className="text-ink-soft">{chosen.detail}</span>
                          <button onClick={() => setChosen(null)} className="ml-2 text-ink-soft underline">
                            change
                          </button>
                        </p>
                        <p className="text-[11px] text-ink-soft">
                          Approving attaches {r.readingCount.toLocaleString()} readings to this transformer,
                          re-analyses every one of them against the rating on the register — not the{" "}
                          {r.ratingKvaAsRecorded ?? "assumed"} kVA in the file — raises any alerts the data
                          justifies, and writes a load check to its lifecycle chain.
                        </p>
                        <button
                          onClick={() => approve(r)}
                          disabled={busy !== null}
                          className="rounded-lg bg-kplc px-5 py-2.5 text-xs font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
                        >
                          {busy === r.id ? "Approving…" : `Approve onto ${chosen.label}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
