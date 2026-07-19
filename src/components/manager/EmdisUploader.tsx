"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Block = {
  substationCode: string | null;
  serial: string | null;
  make: string | null;
  ratingKva: number | null;
  readings: number;
  firstReadingAt: string;
  lastReadingAt: string;
  intervalSeconds: number;
  spanHours: number;
  claimedTimeRange: string | null;
  match: {
    transformerId: string | null;
    label: string | null;
    method: string;
    registerRatingKva: number | null;
    ratingMismatch: boolean;
  };
};

export function EmdisUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ blocks: Block[]; totalReadings: number; rejected: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(mode: "preview" | "commit", f: File) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(`/api/emdis/upload?mode=${mode}`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "That file could not be read."); return null; }
    return data;
  }

  return (
    <div className="space-y-5">
      {!preview && !done && (
        <div className="rounded-2xl border border-line bg-white p-6">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFile(f);
              const d = await run("preview", f);
              if (d) setPreview(d);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full rounded-xl border-2 border-dashed border-line px-6 py-12 text-center transition hover:border-kplc hover:bg-kplc/5 disabled:opacity-50"
          >
            <span className="block text-3xl">⚡</span>
            <span className="mt-3 block text-sm font-bold text-navy">
              {busy ? "Reading the export…" : "Upload an EMDis export"}
            </span>
            <span className="mt-1 block text-xs text-ink-soft">
              CSV or Excel, up to 40 MB. Multi-transformer exports are handled.
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
          <p className="text-sm font-bold text-navy">✅ {done}</p>
          <button
            onClick={() => { setDone(null); setPreview(null); setFile(null); }}
            className="mt-3 rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy"
          >
            Upload another
          </button>
        </div>
      )}

      {preview && (
        <>
          <div className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-5 py-3">
              <h2 className="text-sm font-bold text-navy">
                {preview.blocks.length} transformer block{preview.blocks.length === 1 ? "" : "s"} ·{" "}
                {preview.totalReadings.toLocaleString()} readings
              </h2>
            </div>
            <ul className="divide-y divide-line">
              {preview.blocks.map((b, i) => (
                <li key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-navy">
                      Substation {b.substationCode ?? "—"}
                      {b.make ? ` · ${b.make}` : ""}
                      {b.ratingKva ? ` · ${b.ratingKva} kVA` : ""}
                    </p>
                    {b.match.transformerId ? (
                      <span className="text-xs font-bold text-kplc">
                        → G-{b.match.label} via {b.match.method.replace(/_/g, " ").toLowerCase()}
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-amber-700">
                        no transformer on the register matches
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">
                    serial {b.serial ?? "—"} · {b.readings.toLocaleString()} readings at{" "}
                    {b.intervalSeconds}s · {b.spanHours.toFixed(1)} h from{" "}
                    {b.firstReadingAt.slice(0, 16).replace("T", " ")}
                  </p>

                  {b.match.ratingMismatch && (
                    <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <strong>Rating disagreement.</strong> The file says {b.ratingKva} kVA, the
                      register says {b.match.registerRatingKva} kVA. This is not cosmetic — it changes
                      rated current and therefore every overload judgement. The register&apos;s value
                      will be used.
                    </p>
                  )}

                  {b.claimedTimeRange && b.spanHours < 24 * 300 && b.claimedTimeRange.includes("y") && (
                    <p className="mt-2 rounded border border-line bg-surface-2 px-3 py-2 text-xs text-ink-soft">
                      The header claims a time range of &ldquo;{b.claimedTimeRange}&rdquo; but the file
                      holds {(b.spanHours / 24).toFixed(1)} days. Worth telling George — the export
                      filter did not apply.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={async () => {
                if (!file) return;
                const d = await run("commit", file);
                if (d) {
                  setDone(
                    `${d.totalReadings.toLocaleString()} readings ingested · ` +
                    `${d.datasets.filter((x: { matched: boolean }) => x.matched).length} matched · ` +
                    `${d.datasets.reduce((s: number, x: { alertsRaised: number }) => s + x.alertsRaised, 0)} alerts raised`,
                  );
                  setPreview(null);
                  router.refresh();
                }
              }}
              disabled={busy}
              className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
            >
              {busy ? "Ingesting…" : `Ingest ${preview.totalReadings.toLocaleString()} readings`}
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null); }}
              className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
