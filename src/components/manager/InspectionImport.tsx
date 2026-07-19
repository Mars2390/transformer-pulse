"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PreviewRow = {
  reportId: number;
  inspectedOn: string;
  substation: string;
  gNumber: string | null;
  serial: string | null;
  structure: string | null;
  loading: string;
  earthFlag: string | null;
  outcome: "MATCHED" | "STAGED" | "REJECTED" | "DUPLICATE";
  matchedBy: string;
  transformerLabel: string | null;
  reviewReasons: string[];
};

type Preview = {
  rows: PreviewRow[];
  totals: { total: number; matched: number; staged: number; rejected: number; duplicate: number; flagged: number };
  headline: {
    rottenOrLeaning: number;
    fuseCarriersNeedReplacement: number;
    openEarths: number;
    loadingNotOkay: number;
    earthsOverTenOhm: number;
  };
  unmappedColumns: string[];
};

export function InspectionImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "MATCHED" | "STAGED" | "DUPLICATE" | "flagged">("all");

  async function runPreview(f: File) {
    setBusy(true); setError(null); setPreview(null); setDone(null);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/inspections/preview", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "That file could not be read."); return; }
    setPreview(data);
  }

  async function commit() {
    if (!file) return;
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/inspections/commit", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "The import failed."); return; }
    setDone(
      `${data.imported} inspection${data.imported === 1 ? "" : "s"} matched to transformers, ` +
      `${data.staged} staged, ${data.duplicate} already present, ${data.conflictsRaised} conflict${data.conflictsRaised === 1 ? "" : "s"} raised.`,
    );
    setPreview(null); setFile(null);
    router.refresh();
  }

  const shown = preview?.rows.filter((r) =>
    filter === "all" ? true : filter === "flagged" ? r.reviewReasons.length > 0 : r.outcome === filter,
  ) ?? [];

  return (
    <div className="space-y-6">
      {/* --- Pick a file --------------------------------------------------- */}
      {!preview && !done && (
        <div className="rounded-2xl border border-line bg-white p-6">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setFile(f); runPreview(f); }
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full rounded-xl border-2 border-dashed border-line px-6 py-12 text-center transition hover:border-kplc hover:bg-kplc/5 disabled:opacity-50"
          >
            <span className="block text-3xl">📋</span>
            <span className="mt-3 block text-sm font-bold text-navy">
              {busy ? "Reading the register…" : "Choose the inspection register"}
            </span>
            <span className="mt-1 block text-xs text-ink-soft">
              CSV or Excel, up to 25 MB. Nothing is written until you review it.
            </span>
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}

      {done && (
        <div className="rounded-2xl border border-kplc/30 bg-kplc/5 p-6">
          <p className="text-sm font-bold text-navy">✅ Register imported</p>
          <p className="mt-1 text-sm text-ink-soft">{done}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/manager/inspections" className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white">
              View inspections
            </Link>
            <Link href="/manager/conflicts" className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy">
              Resolve conflicts
            </Link>
            <button onClick={() => setDone(null)} className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy">
              Import another
            </button>
          </div>
        </div>
      )}

      {/* --- Review ---------------------------------------------------------- */}
      {preview && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Matched" value={preview.totals.matched} tone="good" hint="attach to a transformer" />
            <Tile label="Staged" value={preview.totals.staged} tone="warn" hint="no transformer yet" />
            <Tile label="Already present" value={preview.totals.duplicate} tone="mute" hint="skipped" />
            <Tile label="Needs review" value={preview.totals.flagged} tone="warn" hint="a value was refused" />
            <Tile label="Unreadable" value={preview.totals.rejected} tone={preview.totals.rejected ? "bad" : "mute"} />
          </div>

          {/* What this register actually says */}
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="text-xs font-bold tracking-[0.1em] text-ink-soft">WHAT THIS REGISTER REPORTS</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Finding n={preview.headline.rottenOrLeaning} label="poles rotten or leaning" tone="bad" />
              <Finding n={preview.headline.fuseCarriersNeedReplacement} label="fuse carriers to replace" tone="warn" />
              <Finding n={preview.headline.openEarths} label="open earths (tester read OL)" tone="bad" />
              <Finding n={preview.headline.earthsOverTenOhm} label="earths above 10 Ω" tone="warn" />
              <Finding n={preview.headline.loadingNotOkay} label="flagged overloaded by eye" tone="warn" />
            </div>
          </div>

          {preview.unmappedColumns.length > 0 && (
            <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs text-ink-soft">
              <strong className="text-navy">Columns not imported:</strong>{" "}
              {preview.unmappedColumns.join(", ")} — these were empty or unrecognised.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "MATCHED", "STAGED", "DUPLICATE", "flagged"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === f ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"}`}
              >
                {f === "all" ? "All" : f === "flagged" ? "Needs review" : f[0] + f.slice(1).toLowerCase()}
              </button>
            ))}
            <span className="ml-auto text-xs text-ink-soft">{shown.length} shown</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Report</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Substation</th>
                  <th className="px-3 py-2">G-Number</th>
                  <th className="px-3 py-2">Pole</th>
                  <th className="px-3 py-2">Loading</th>
                  <th className="px-3 py-2">Earth</th>
                  <th className="px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.slice(0, 300).map((r) => (
                  <tr key={r.reportId} className={r.reviewReasons.length ? "bg-amber-50/50" : undefined}>
                    <td className="px-3 py-2 font-mono">{r.reportId}</td>
                    <td className="px-3 py-2">{r.inspectedOn}</td>
                    <td className="max-w-[220px] truncate px-3 py-2">{r.substation}</td>
                    <td className="px-3 py-2 font-mono">{r.gNumber ?? <span className="text-ink-soft">—</span>}</td>
                    <td className="px-3 py-2">
                      {r.structure === "ROTTEN" ? <span className="font-bold text-red-700">rotten</span>
                        : r.structure === "LEANING" ? <span className="font-bold text-amber-700">leaning</span>
                        : r.structure === "OKAY" ? <span className="text-ink-soft">okay</span> : "—"}
                    </td>
                    <td className="px-3 py-2">{r.loading.startsWith("NOT OK") ? <span className="font-bold text-red-700">{r.loading}</span> : r.loading}</td>
                    <td className="px-3 py-2">
                      {r.earthFlag === "OPEN" ? <span className="font-bold text-red-700">OPEN</span>
                        : r.earthFlag ? <span className="font-bold text-amber-700">{r.earthFlag}</span> : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Outcome outcome={r.outcome} by={r.matchedBy} label={r.transformerLabel} />
                      {r.reviewReasons.length > 0 && (
                        <span className="mt-0.5 block text-[10px] text-amber-800">{r.reviewReasons[0]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 300 && (
              <p className="border-t border-line px-3 py-2 text-[11px] text-ink-soft">
                Showing the first 300 of {shown.length}. All will be imported.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={commit}
              disabled={busy}
              className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
            >
              {busy ? "Importing…" : `Import ${preview.totals.matched + preview.totals.staged} inspections`}
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null); }}
              className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs leading-relaxed text-ink-soft">
            Identity fields on these forms — make, rating, year — are stored against the inspection, not written
            over the register. Where a form disagrees with what we hold, a conflict is raised for a person to
            settle. The importer does not decide which inspector was right.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: number; tone: "good" | "warn" | "bad" | "mute"; hint?: string }) {
  const c = { good: "text-kplc", warn: "text-amber-700", bad: "text-red-700", mute: "text-ink-soft" }[tone];
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-[11px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className={`mt-1 text-2xl font-extrabold ${c}`}>{value}</p>
      {hint && <p className="text-[10px] text-ink-soft">{hint}</p>}
    </div>
  );
}

function Finding({ n, label, tone }: { n: number; label: string; tone: "warn" | "bad" }) {
  return (
    <div>
      <p className={`text-xl font-extrabold ${tone === "bad" ? "text-red-700" : "text-amber-700"}`}>{n}</p>
      <p className="text-[11px] leading-snug text-ink-soft">{label}</p>
    </div>
  );
}

function Outcome({ outcome, by, label }: { outcome: string; by: string; label: string | null }) {
  if (outcome === "MATCHED")
    return (
      <span className="text-[11px] font-bold text-kplc">
        → {label} <span className="font-normal text-ink-soft">via {by.replace(/_/g, " ").toLowerCase()}</span>
      </span>
    );
  if (outcome === "DUPLICATE") return <span className="text-[11px] text-ink-soft">already imported</span>;
  return <span className="text-[11px] font-bold text-amber-700">staged — no transformer</span>;
}
