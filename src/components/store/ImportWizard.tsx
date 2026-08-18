"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui";
import { FormError } from "@/components/ui/Field";

/**
 * The bulk-import wizard: pick a file, see exactly what will happen, then
 * commit in batches with a progress bar.
 *
 * Nothing is written until the user presses Import. Rows with errors are never
 * sent — they are listed with their row number and the specific problem, so the
 * user can fix the spreadsheet rather than guess.
 */

type Row = {
  rowNumber: number;
  level: "valid" | "warning" | "error";
  errors: string[];
  warnings: string[];
  duplicate: boolean;
  data: Record<string, unknown> & { serialNumber: string; manufacturerName: string; ratingKva: number | null; status: string };
};

type Preview = {
  fileName: string;
  totalRows: number;
  summary: { valid: number; warning: number; error: number; duplicates: number };
  recognisedColumns: string[];
  unmappedColumns: string[];
  rows: Row[];
};

type Result = { imported: number; updated: number; skipped: number; failed: number; failures: { serialNumber: string; reason: string }[] };

const BATCH = 40;

export function ImportWizard() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "update">("skip");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/import/preview", { method: "POST", body });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not read that file."); return; }
    setPreview(data);
  }

  async function commit() {
    if (!preview) return;
    const importable = preview.rows.filter((r) => r.level !== "error").map((r) => r.data);
    if (!importable.length) { setError("There are no valid rows to import."); return; }

    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: importable.length });

    const totals: Result = { imported: 0, updated: 0, skipped: 0, failed: 0, failures: [] };

    for (let i = 0; i < importable.length; i += BATCH) {
      const slice = importable.slice(i, i + BATCH);
      const isFinalBatch = i + BATCH >= importable.length;
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: slice,
          fileName: preview.fileName,
          onDuplicate,
          isFinalBatch,
          totals: { imported: totals.imported, updated: totals.updated, skipped: totals.skipped, failed: totals.failed },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Import failed part-way. Nothing further was written."); break; }
      totals.imported += data.imported;
      totals.updated += data.updated;
      totals.skipped += data.skipped;
      totals.failed += data.failed;
      totals.failures.push(...(data.failures ?? []));
      setProgress({ done: Math.min(i + BATCH, importable.length), total: importable.length });
    }

    setBusy(false);
    setProgress(null);
    setResult(totals);
  }

  function downloadErrors() {
    if (!preview) return;
    const bad = preview.rows.filter((r) => r.level === "error");
    const lines = ["Row,Serial Number,Problem"];
    for (const r of bad) {
      lines.push(`${r.rowNumber},"${r.data.serialNumber ?? ""}","${r.errors.join("; ").replace(/"/g, '""')}"`);
    }
    for (const f of result?.failures ?? []) {
      lines.push(`,"${f.serialNumber}","${f.reason.replace(/"/g, '""')}"`);
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (result) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="text-lg font-bold text-emerald-900">Import complete</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Imported" value={result.imported} tone="text-emerald-700" />
            <Stat label="Updated" value={result.updated} tone="text-kplc" />
            <Stat label="Skipped" value={result.skipped} tone="text-ink-soft" />
            <Stat label="Failed" value={result.failed} tone={result.failed ? "text-red-600" : "text-ink-soft"} />
          </div>
        </div>

        {result.failures.length > 0 && (
          <div className="rounded-2xl border border-red-200 bg-white">
            <div className="border-b border-line px-5 py-3">
              <h3 className="text-sm font-bold text-red-800">Rows that failed ({result.failures.length})</h3>
            </div>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto">
              {result.failures.map((f, i) => (
                <li key={i} className="px-5 py-2.5 text-[13px]">
                  <span className="font-mono font-bold text-navy">{f.serialNumber}</span>
                  <span className="text-ink-soft"> — {f.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Link href="/transformers" className="rounded-xl bg-kplc px-5 py-3 text-sm font-bold text-white hover:bg-kplc-light">
            View imported transformers
          </Link>
          {(result.failed > 0 || (preview?.summary.error ?? 0) > 0) && (
            <button type="button" onClick={downloadErrors} className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy hover:border-navy/30">
              Download error report
            </button>
          )}
          <button type="button" onClick={() => { setResult(null); setPreview(null); setFile(null); }} className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy hover:border-navy/30">
            Import another file
          </button>
        </div>
      </div>
    );
  }

  if (preview) {
    const importable = preview.summary.valid + preview.summary.warning;
    const errorRows = preview.rows.filter((r) => r.level === "error");

    return (
      <div className="space-y-5">
        {error && <FormError message={error} />}

        <div className="rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-navy">{preview.fileName}</h2>
            <span className="text-xs text-ink-soft">{preview.totalRows} rows read</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Ready" value={preview.summary.valid} tone="text-emerald-600" />
            <Stat label="With warnings" value={preview.summary.warning} tone="text-amber-600" />
            <Stat label="Errors (skipped)" value={preview.summary.error} tone={preview.summary.error ? "text-red-600" : "text-ink-soft"} />
            <Stat label="Already exist" value={preview.summary.duplicates} tone="text-ink-soft" />
          </div>

          {preview.unmappedColumns.length > 0 && (
            <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">
              Columns not recognised and ignored: {preview.unmappedColumns.join(", ")}
            </p>
          )}

          {preview.summary.duplicates > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-900">
                {preview.summary.duplicates} serial number{preview.summary.duplicates === 1 ? "" : "s"} already in the system
              </p>
              <div className="mt-2 flex gap-2">
                {(["skip", "update"] as const).map((mode) => (
                  <button key={mode} type="button" onClick={() => setOnDuplicate(mode)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${onDuplicate === mode ? "bg-amber-600 text-white" : "border border-amber-300 bg-white text-amber-800"}`}>
                    {mode === "skip" ? "Skip them" : "Update their specification"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-amber-800">
                Updating fills in the nameplate only. It never alters an existing transformer&apos;s history.
              </p>
            </div>
          )}
        </div>

        {errorRows.length > 0 && (
          <div className="rounded-2xl border border-red-200 bg-white">
            <div className="border-b border-line px-5 py-3">
              <h3 className="text-sm font-bold text-red-800">These rows will be skipped ({errorRows.length})</h3>
            </div>
            <ul className="max-h-56 divide-y divide-line overflow-y-auto">
              {errorRows.slice(0, 50).map((r) => (
                <li key={r.rowNumber} className="px-5 py-2.5 text-[13px]">
                  <span className="font-bold text-navy">Row {r.rowNumber}</span>
                  <span className="text-ink-soft"> — {r.errors.join("; ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3">ROW</th>
                <th className="px-4 py-3">SERIAL</th>
                <th className="px-4 py-3">MANUFACTURER</th>
                <th className="px-4 py-3">kVA</th>
                <th className="px-4 py-3">STATUS</th>
                <th className="px-4 py-3">CHECK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.rows.slice(0, 10).map((r) => (
                <tr key={r.rowNumber} className="hover:bg-surface">
                  <td className="px-4 py-3 text-ink-soft">{r.rowNumber}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-navy">{r.data.serialNumber || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.data.manufacturerName || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.data.ratingKva ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.data.status?.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">
                    <Badge tone={r.level === "valid" ? "success" : r.level === "warning" ? "warning" : "danger"}>
                      {r.level === "valid" ? "Ready" : r.level === "warning" ? "Warning" : "Error"}
                    </Badge>
                    {(r.warnings.length > 0 || r.errors.length > 0) && (
                      <p className="mt-1 text-[11px] text-ink-soft">{[...r.errors, ...r.warnings][0]}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.rows.length > 10 && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-ink-soft">
              Showing the first 10 of {preview.rows.length} rows.
            </p>
          )}
        </div>

        {progress && (
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="text-sm font-semibold text-navy">
              Importing {progress.done} of {progress.total} transformers…
            </p>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-kplc transition-all duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={commit} disabled={busy || importable === 0}
            className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 hover:bg-kplc-light disabled:opacity-50">
            {busy ? "Importing…" : `Import ${importable} transformer${importable === 1 ? "" : "s"}`}
          </button>
          <button type="button" onClick={() => { setPreview(null); setFile(null); }} disabled={busy}
            className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy hover:border-navy/30 disabled:opacity-50">
            Cancel
          </button>
          {errorRows.length > 0 && (
            <button type="button" onClick={downloadErrors} className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy hover:border-navy/30">
              Download error report
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <FormError message={error} />}

      <div className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-navy">1. Start from a template</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Or upload your existing sheet — the importer recognises most common column names on its own.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/import/template?type=quick&format=xlsx" className="inline-flex min-h-11 items-center rounded-lg bg-kplc px-4 text-xs font-bold text-white hover:bg-kplc-light">Quick template (XLSX)</a>
          <a href="/api/import/template?type=quick&format=csv" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-xs font-bold text-navy hover:border-kplc">Quick (CSV)</a>
          <a href="/api/import/template?type=full&format=xlsx" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-xs font-bold text-navy hover:border-kplc">Full template (XLSX)</a>
          <a href="/api/import/template?type=full&format=csv" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-xs font-bold text-navy hover:border-kplc">Full (CSV)</a>
        </div>
      </div>

      <div className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-navy">2. Upload your file</h2>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files?.[0] ?? null); }}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? "border-kplc bg-kplc/5" : "border-line hover:border-kplc/50"
          }`}
        >
          {file ? (
            <div>
              <p className="text-sm font-bold text-navy">{file.name}</p>
              <p className="mt-1 text-xs text-ink-soft">{(file.size / 1024).toFixed(0)} KB — click to choose a different file</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-navy">Drop your file here, or click to browse</p>
              <p className="mt-1 text-xs text-ink-soft">.csv, .xlsx or .xls — up to 10 MB, 5000 rows</p>
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={(e) => choose(e.target.files?.[0] ?? null)} />

        <button type="button" onClick={upload} disabled={!file || busy}
          className="mt-4 w-full rounded-xl bg-kplc py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 hover:bg-kplc-light disabled:opacity-45 sm:w-auto sm:px-6">
          {busy ? "Reading…" : "Upload & preview"}
        </button>
        <p className="mt-2 text-xs text-ink-soft">Nothing is saved until you review the preview and confirm.</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}
