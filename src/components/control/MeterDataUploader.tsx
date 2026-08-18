"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, FormError, inputClass } from "@/components/ui/Field";

type Existing = {
  id: string; name: string; meterCount: number; intervalCount: number;
  ratingKva: number; transformerRef: string | null; uploadedByName: string; createdAtISO: string;
} | null;

/** Upload, inspect and clear the meter dataset the control centre replays. */
export function MeterDataUploader({ existing }: { existing: Existing }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ readings: number; meters: number; intervals: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(null); setResult(null);

    const form = new FormData(e.currentTarget);
    form.set("file", file);

    const res = await fetch("/api/control/upload", { method: "POST", body: form });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Upload failed."); return; }

    setResult({ readings: data.readings, meters: data.dataset.meterCount, intervals: data.dataset.intervalCount });
    router.refresh();
  }

  async function clearData() {
    if (!window.confirm("Delete the current meter dataset? The control centre will have nothing to replay until you upload again.")) return;
    setBusy(true);
    await fetch("/api/control/upload", { method: "DELETE" });
    setBusy(false);
    setResult(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {existing && (
        <div className="rounded-2xl border border-kplc/20 bg-kplc/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold tracking-[0.1em] text-kplc">LOADED AND READY</p>
              <p className="mt-1 font-mono text-sm font-bold text-navy">{existing.name}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {existing.meterCount.toLocaleString()} meters · {existing.intervalCount} intervals ·{" "}
                {(existing.meterCount * existing.intervalCount).toLocaleString()} readings ·{" "}
                {existing.ratingKva} kVA {existing.transformerRef ? `· ${existing.transformerRef}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Uploaded by {existing.uploadedByName}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/kplc-control" className="inline-flex min-h-11 items-center rounded-xl bg-kplc px-4 text-xs font-bold text-white hover:bg-kplc-light">
                Open control centre
              </Link>
              <button type="button" onClick={clearData} disabled={busy}
                className="inline-flex min-h-11 items-center rounded-xl border border-red-200 px-4 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                Delete data
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-bold text-emerald-900">
            Uploaded: {result.readings.toLocaleString()} readings for {result.meters.toLocaleString()} meters over {result.intervals} intervals.
          </p>
          <p className="mt-1 text-xs text-emerald-800">Ready for the live monitoring demonstration.</p>
        </div>
      )}

      <form onSubmit={upload} className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-navy">Upload meter data</h2>
        <p className="mt-1 text-xs text-ink-soft">
          CSV or Excel with columns: meterId, timestamp, voltage, current, power, powerFactor.
          Uploading replaces whatever is currently loaded.
        </p>

        {error && <div className="mt-4"><FormError message={error} /></div>}

        <div
          onDragOver={(ev) => { ev.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(ev) => { ev.preventDefault(); setDragging(false); setFile(ev.dataTransfer.files?.[0] ?? null); }}
          onClick={() => inputRef.current?.click()}
          className={`mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? "border-kplc bg-kplc/5" : "border-line hover:border-kplc/50"
          }`}
        >
          {file ? (
            <>
              <p className="text-sm font-bold text-navy">{file.name}</p>
              <p className="mt-1 text-xs text-ink-soft">{(file.size / 1024 / 1024).toFixed(2)} MB — click to change</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-navy">Drop the meter file here, or click to browse</p>
              <p className="mt-1 text-xs text-ink-soft">.csv, .xlsx or .xls — up to 25 MB</p>
            </>
          )}
        </div>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Transformer" htmlFor="transformerRef" hint="G-Number these meters are fed from">
            <input id="transformerRef" name="transformerRef" defaultValue={existing?.transformerRef ?? ""} placeholder="G-2026-00012" className={inputClass} />
          </Field>
          <Field label="Rating (kVA)" htmlFor="ratingKva" hint="Nameplate rating — the gauge scales to it">
            <input id="ratingKva" name="ratingKva" type="number" defaultValue={existing?.ratingKva ?? 200} className={inputClass} />
          </Field>
        </div>

        <button type="submit" disabled={!file || busy}
          className="mt-4 w-full rounded-xl bg-kplc py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 hover:bg-kplc-light disabled:opacity-45 sm:w-auto sm:px-6">
          {busy ? "Ingesting…" : "Upload & parse"}
        </button>
        <p className="mt-2 text-xs text-ink-soft">
          ~96,000 rows is normal for 1,000 meters over 24 hours. Inserted in chunks — allow a moment.
        </p>
      </form>
    </div>
  );
}
