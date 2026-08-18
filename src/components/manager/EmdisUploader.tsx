"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CANON_LABEL, type CanonField } from "@/lib/universal-columns";

/**
 * The load-data upload and confirm screen.
 *
 * One file input feeds a preview that says plainly what kind of file arrived,
 * which columns were recognised and which were not, and — for a flat table with
 * no identity of its own — lets the engineer attach it to a transformer before a
 * single row is written. Nothing imports until the engineer confirms.
 */

type Detection = {
  layout: "emdis" | "flat-table" | "unknown";
  phases: 0 | 1 | 3;
  hasCurrent: boolean; hasVoltage: boolean; hasPower: boolean; hasTimestamp: boolean;
  summary: string;
};

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

type Preview = {
  layout: "emdis" | "flat-table";
  detection: Detection;
  columnMapping: {
    columns: { index: number; header: string; mappedTo: CanonField | null }[];
    unmapped: string[];
    missing: CanonField[];
    mappedCount: number;
    totalColumns: number;
  };
  matchedProfile: { id: string; name: string } | null;
  blocks: Block[];
  totalReadings: number;
  rejected: number;
};

type HealthUpdate = { transformerId: string; label: string; level: string; explanation: string; alertsRaised: number };

const LEVEL_EMOJI: Record<string, string> = {
  HEALTHY: "🔵", BREATHING: "🟢", SURVIVING: "🟡", CRITICAL: "🔴", DECEASED: "⚫", UNVERIFIED: "⚪",
};

/** "✅ G-153457 analyzed. Health: CRITICAL. 3 new alerts. Phase L3 at 121%..." */
function healthToast(updates: HealthUpdate[]): string | null {
  if (!updates.length) return null;
  if (updates.length === 1) {
    const u = updates[0];
    return (
      `${LEVEL_EMOJI[u.level] ?? ""} ${u.label} analyzed. Health: ${u.level}. ` +
      `${u.alertsRaised} new alert${u.alertsRaised === 1 ? "" : "s"}. ${u.explanation}`
    );
  }
  const critical = updates.filter((u) => u.level === "CRITICAL" || u.level === "SURVIVING").length;
  return (
    `${updates.length} transformers analyzed` +
    (critical ? ` — ${critical} need attention (Surviving or Critical).` : " — all Healthy or Breathing.")
  );
}

type Hit = { id: string; label: string; detail: string };

const FIELD_OPTIONS = Object.entries(CANON_LABEL) as [CanonField, string][];

export function EmdisUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);

  // Confirm-screen decisions.
  const [override, setOverride] = useState<Record<string, CanonField>>({});
  const [editingMap, setEditingMap] = useState(false);
  const [chosen, setChosen] = useState<Hit | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState("");

  function reset() {
    setPreview(null); setFile(null); setDone(null); setHealthMsg(null); setError(null);
    setOverride({}); setEditingMap(false); setChosen(null);
    setQuery(""); setHits([]); setSaveProfile(false); setProfileName("");
  }

  async function run(mode: "preview" | "commit", f: File, ov: Record<string, CanonField>) {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.append("file", f);
    if (Object.keys(ov).length) fd.append("mapping", JSON.stringify(ov));
    if (mode === "commit") {
      if (chosen) fd.append("transformerId", chosen.id);
      if (saveProfile && profileName.trim()) fd.append("saveProfileName", profileName.trim());
    }
    const res = await fetch(`/api/emdis/upload?mode=${mode}`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "That file could not be read."); return null; }
    return data;
  }

  async function reassign(header: string, field: CanonField | "") {
    if (!file) return;
    const next = { ...override };
    if (field === "") delete next[header];
    else next[header] = field;
    setOverride(next);
    const d = await run("preview", file, next);
    if (d) setPreview(d);
  }

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setHits([]); return; }
    const res = await fetch(`/api/transformers/search?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({ results: [] }));
    setHits(data.results ?? []);
  }

  if (!preview && !done) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-white p-6">
          <input
            ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              reset(); setFile(f);
              const d = await run("preview", f, {});
              if (d) setPreview(d);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()} disabled={busy}
            className="w-full rounded-xl border-2 border-dashed border-line px-6 py-12 text-center transition hover:border-kplc hover:bg-kplc/5 disabled:opacity-50"
          >
            <span className="block text-3xl">⚡</span>
            <span className="mt-3 block text-sm font-bold text-navy">
              {busy ? "Reading the file…" : "Upload load data"}
            </span>
            <span className="mt-1 block text-xs text-ink-soft">
              CSV or Excel, up to 40 MB. EMDis reports and plain column tables are both understood —
              the format is detected automatically.
            </span>
          </button>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-kplc/30 bg-kplc/5 p-6">
        <p className="text-sm font-bold text-navy">✅ {done}</p>
        {healthMsg && (
          <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-navy">{healthMsg}</p>
        )}
        <button onClick={reset} className="mt-3 rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy">
          Upload another
        </button>
      </div>
    );
  }

  const p = preview!;
  const mappedFields = new Set(p.columnMapping.columns.map((c) => c.mappedTo).filter(Boolean) as CanonField[]);
  const measures = [
    (mappedFields.has("l1c") || mappedFields.has("l2c") || mappedFields.has("l3c")) && "Current",
    ([...mappedFields].some((f) => f.endsWith("V"))) && "Voltage",
    (mappedFields.has("kva") || mappedFields.has("kw")) && "Power",
    mappedFields.has("pf") && "PF",
    mappedFields.has("thdPct") && "THD",
    mappedFields.has("neutralC") && "Neutral",
    mappedFields.has("hz") && "Frequency",
  ].filter(Boolean) as string[];

  const isEmdis = p.layout === "emdis";
  const single = p.blocks[0] ?? null;
  const identityMatched = p.blocks.some((b) => b.match.transformerId);
  const needsIdentity = !isEmdis && p.blocks.length === 1 && !identityMatched && !chosen;
  const interval = single ? fmtInterval(single.intervalSeconds) : "—";

  return (
    <div className="space-y-4">
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-5 py-3">
        <span className="text-lg">📂</span>
        <span className="text-sm font-bold text-navy">{file?.name}</span>
        {p.matchedProfile && (
          <span className="ml-auto rounded-full bg-kplc/10 px-3 py-1 text-[11px] font-bold text-kplc">
            Recognised as “{p.matchedProfile.name}”
          </span>
        )}
      </div>

      {/* Detection */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="grid gap-2 sm:grid-cols-2">
          <Detected label="Format" ok value={isEmdis ? "KPLC EMDis report" : "Flat table"} />
          <Detected
            label="Structure"
            ok
            value={`${p.columnMapping.totalColumns} columns · ${p.totalReadings.toLocaleString()} rows`}
          />
          <Detected
            label="Phase count"
            ok={p.detection.phases > 0}
            value={p.detection.phases === 3 ? "Three-phase (L1, L2, L3 detected)"
              : p.detection.phases === 1 ? "Single-phase" : "No phase current recognised"}
          />
          <Detected label="Time interval" ok value={interval} />
          <div className="sm:col-span-2">
            <Detected label="Measurements present" ok={measures.length > 0} value={measures.join(", ") || "none recognised"} />
          </div>
        </div>

        {p.detection.phases === 1 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            <strong>Single-phase data.</strong> Per-phase balancing and unbalance analysis need all
            three phases, so those views will be disabled for this dataset. Loading, thermal and
            voltage analysis still run.
          </p>
        )}
        {p.detection.phases === 0 && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
            <strong>No phase current recognised.</strong> Use “Edit mapping” below to point the
            current columns at L1 / L2 / L3 by hand, or this file will import with no loading analysis.
          </p>
        )}
      </div>

      {/* Column mapping */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-sm font-bold text-navy">
            Column mapping ({p.columnMapping.mappedCount} of {p.columnMapping.totalColumns} mapped)
          </h3>
          <button
            onClick={() => setEditingMap((v) => !v)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-navy hover:border-kplc"
          >
            {editingMap ? "Done editing" : "Edit mapping"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                <th className="px-5 py-2">Your column</th>
                <th className="px-5 py-2">System field</th>
                <th className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.columnMapping.columns.map((c) => (
                <tr key={c.index}>
                  <td className="px-5 py-2 font-mono text-xs text-navy">{c.header || <span className="text-ink-soft">(blank)</span>}</td>
                  <td className="px-5 py-2">
                    {editingMap ? (
                      <select
                        value={c.mappedTo ?? ""}
                        onChange={(e) => reassign(c.header, e.target.value as CanonField | "")}
                        className="rounded border border-line px-2 py-1 text-xs"
                      >
                        <option value="">— ignore —</option>
                        {FIELD_OPTIONS.map(([f, label]) => (
                          <option key={f} value={f}>{label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={c.mappedTo ? "font-semibold text-navy" : "text-ink-soft"}>
                        {c.mappedTo ? CANON_LABEL[c.mappedTo] : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2">
                    {c.mappedTo
                      ? <span className="text-kplc">✅</span>
                      : <span className="text-[11px] font-semibold text-ink-soft">ignored</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.columnMapping.unmapped.length > 0 && (
          <p className="border-t border-line bg-surface-2 px-5 py-3 text-xs text-ink-soft">
            ⚠️ {p.columnMapping.unmapped.length} column{p.columnMapping.unmapped.length === 1 ? "" : "s"} not
            recognised and ignored: {p.columnMapping.unmapped.map((u) => `“${u}”`).join(", ")}. If any is a
            measurement, assign it with “Edit mapping”.
          </p>
        )}
      </div>

      {/* Transformer identity */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <h3 className="text-sm font-bold text-navy">Transformer identity</h3>
        {isEmdis ? (
          <ul className="mt-2 space-y-1 text-xs">
            {p.blocks.map((b, i) => (
              <li key={i} className={b.match.transformerId ? "text-kplc" : "text-amber-700"}>
                {b.match.transformerId
                  ? `✅ Substation ${b.substationCode ?? "—"} → G-${b.match.label} (via ${b.match.method.replace(/_/g, " ").toLowerCase()})`
                  : `⚠️ Substation ${b.substationCode ?? "—"} · serial ${b.serial ?? "—"} — no register match; will import unattached`}
              </li>
            ))}
          </ul>
        ) : identityMatched ? (
          <p className="mt-2 text-xs text-kplc">
            ✅ Matched from the file: {single?.serial ? `serial ${single.serial}` : single?.substationCode} →
            G-{single?.match.label}
          </p>
        ) : chosen ? (
          <p className="mt-2 flex items-center gap-2 text-xs">
            <span className="font-bold text-kplc">✅ {chosen.label}</span>
            <span className="text-ink-soft">{chosen.detail}</span>
            <button onClick={() => setChosen(null)} className="ml-2 text-ink-soft underline">change</button>
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {single?.serial && (
              <p className="text-xs text-amber-700">
                The file names serial <strong>{single.serial}</strong> but no transformer on the register
                matches it. Attach it below, or import unattached.
              </p>
            )}
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search the register by G-Number, serial or site…"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
            {hits.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      onClick={() => { setChosen(h); setHits([]); setQuery(""); }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface-2"
                    >
                      <span className="font-bold text-navy">{h.label}</span>
                      <span className="text-ink-soft">{h.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-ink-soft">
              Not on the register yet?{" "}
              <Link href="/store-onboard" className="font-semibold text-kplc underline">Onboard it first</Link>,
              then re-upload — or import unattached and attach later.
            </p>
          </div>
        )}
      </div>

      {/* Save profile */}
      {p.columnMapping.mappedCount > 0 && (
        <label className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-5 py-3 text-sm">
          <input type="checkbox" checked={saveProfile} onChange={(e) => setSaveProfile(e.target.checked)} />
          <span className="font-semibold text-navy">Save this mapping as a profile</span>
          {saveProfile && (
            <input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="e.g. KPLC Nairobi EMDis v2"
              className="ml-2 flex-1 rounded-lg border border-line px-3 py-1.5 text-xs"
            />
          )}
        </label>
      )}

      {/* Rating disagreement, if any */}
      {p.blocks.some((b) => b.match.ratingMismatch) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <strong>Rating disagreement.</strong> The file and the register give different kVA for a matched
          unit. This changes rated current and every overload judgement — the register’s value will be used.
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={async () => {
            if (!file) return;
            const d = await run("commit", file, override);
            if (d) {
              setDone(
                `${d.totalReadings.toLocaleString()} readings ingested · ` +
                `${d.datasets.filter((x: { matched: boolean }) => x.matched).length} matched · ` +
                `${d.datasets.reduce((s: number, x: { alertsRaised: number }) => s + x.alertsRaised, 0)} alerts raised`,
              );
              setHealthMsg(healthToast((d.healthUpdates ?? []) as HealthUpdate[]));
              setPreview(null);
              router.refresh();
            }
          }}
          disabled={busy}
          className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : needsIdentity
              ? `✓ Confirm & import unattached (${p.totalReadings.toLocaleString()} readings)`
              : `✓ Confirm & import ${p.totalReadings.toLocaleString()} readings`}
        </button>
        <button onClick={reset} className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Detected({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="shrink-0">{ok ? "✅" : "⚠️"}</span>
      <span className="w-36 shrink-0 text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="font-semibold text-navy">{value}</span>
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
      {children}
    </p>
  );
}

function fmtInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}
