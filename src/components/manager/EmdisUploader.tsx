"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CANON_LABEL, type CanonField } from "@/lib/universal-columns";

/**
 * The load-data upload and confirm screen.
 *
 * Two shapes, because one file and twenty files are different jobs:
 *
 *   One file   the full confirm screen — how the file was read, which columns
 *              were recognised, which transformer it attached to, and any
 *              duplicate finding — with the mapping editable before anything is
 *              written.
 *
 *   Many files each read independently and shown as a row with its own verdict.
 *              A per-file column-mapping editor across twenty files is not a
 *              review, it is a wall, and a wall gets clicked through.
 *
 * Nothing imports until the engineer confirms, in either shape. Failure is per
 * file: one unreadable export in a folder of twenty does not stop the other
 * nineteen, because the alternative teaches people to upload one at a time.
 */

type Detection = {
  layout: "emdis" | "flat-table" | "unknown";
  phases: 0 | 1 | 3;
  hasCurrent: boolean; hasVoltage: boolean; hasPower: boolean; hasTimestamp: boolean;
  summary: string;
};

type DuplicateReport = {
  verdict: "IDENTICAL" | "SAME_RANGE" | "OVERLAP" | "CLEAR";
  blocked: boolean;
  overridable: boolean;
  findings: {
    verdict: string;
    overlapPct: number;
    reason: string;
    against: {
      id: string; name: string; readingCount: number;
      firstReadingAt: string; lastReadingAt: string; createdAt: string;
    };
  }[];
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
  duplicate: DuplicateReport;
  willStage: boolean;
  stagingReason: string | null;
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

type CommitResult = {
  datasets: { matched: boolean; staged: boolean; alertsRaised: number; readings: number }[];
  skipped: { verdict: string; reason: string; readings: number; overridable: boolean }[];
  totalReadings: number;
  healthUpdates: HealthUpdate[];
};

type HealthUpdate = { transformerId: string; label: string; level: string; explanation: string; alertsRaised: number };

/** One file's journey, start to finish. */
type FileState = {
  id: string;
  file: File;
  status: "queued" | "reading" | "ready" | "importing" | "done" | "failed";
  preview: Preview | null;
  result: CommitResult | null;
  error: string | null;
  /** The engineer ticked "import anyway" for an overlap on this file. */
  force: boolean;
};

const LEVEL_EMOJI: Record<string, string> = {
  HEALTHY: "🔵", BREATHING: "🟢", SURVIVING: "🟡", CRITICAL: "🔴", DECEASED: "⚫", UNVERIFIED: "⚪",
};

const VERDICT_LABEL: Record<string, string> = {
  IDENTICAL: "Exact duplicate — refused",
  SAME_RANGE: "Same transformer, same window",
  OVERLAP: "Overlaps data already held",
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

const ACCEPTED = /\.(csv|xlsx|xls)$/i;

let seq = 0;
const nextId = () => `f${++seq}`;

export function EmdisUploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);

  // Confirm-screen decisions. Single-file only: a mapping correction and a
  // hand-picked transformer are both statements about one particular file.
  const [override, setOverride] = useState<Record<string, CanonField>>({});
  const [editingMap, setEditingMap] = useState(false);
  const [chosen, setChosen] = useState<Hit | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState("");

  function reset() {
    setFiles([]); setError(null); setHealthMsg(null);
    setOverride({}); setEditingMap(false); setChosen(null);
    setQuery(""); setHits([]); setSaveProfile(false); setProfileName("");
  }

  function patch(id: string, changes: Partial<FileState>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  }

  async function call(
    mode: "preview" | "commit",
    f: File,
    ov: Record<string, CanonField>,
    opts: { force?: boolean; withChoices?: boolean } = {},
  ): Promise<{ ok: true; data: Preview & CommitResult } | { ok: false; error: string }> {
    const fd = new FormData();
    fd.append("file", f);
    if (Object.keys(ov).length) fd.append("mapping", JSON.stringify(ov));
    if (mode === "commit") {
      if (opts.force) fd.append("force", "true");
      if (opts.withChoices) {
        if (chosen) fd.append("transformerId", chosen.id);
        if (saveProfile && profileName.trim()) fd.append("saveProfileName", profileName.trim());
      }
    }
    try {
      const res = await fetch(`/api/emdis/upload?mode=${mode}`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? "That file could not be read." };
      return { ok: true, data };
    } catch {
      return { ok: false, error: "The upload did not reach the server. Check the connection and try again." };
    }
  }

  /**
   * Read every dropped file.
   *
   * Sequential on purpose. These are 40 MB spreadsheets parsed server-side, and
   * firing twenty at once would queue them behind each other anyway while
   * making the failure of any one of them harder to attribute.
   */
  async function accept(list: FileList | File[]) {
    const incoming = Array.from(list);
    const usable = incoming.filter((f) => ACCEPTED.test(f.name));
    const rejected = incoming.filter((f) => !ACCEPTED.test(f.name));

    setError(
      rejected.length
        ? `Skipped ${rejected.length} file${rejected.length === 1 ? "" : "s"} that ${rejected.length === 1 ? "is" : "are"} not .csv, .xlsx or .xls: ${rejected.map((f) => f.name).join(", ")}.`
        : null,
    );
    if (!usable.length) return;

    const staged: FileState[] = usable.map((file) => ({
      id: nextId(), file, status: "queued", preview: null, result: null, error: null, force: false,
    }));
    setFiles(staged);
    setHealthMsg(null);
    setBusy(true);

    for (const s of staged) {
      patch(s.id, { status: "reading" });
      const r = await call("preview", s.file, {});
      if (r.ok) patch(s.id, { status: "ready", preview: r.data });
      else patch(s.id, { status: "failed", error: r.error });
    }
    setBusy(false);
  }

  async function reassign(header: string, field: CanonField | "") {
    const only = files[0];
    if (!only) return;
    const next = { ...override };
    if (field === "") delete next[header];
    else next[header] = field;
    setOverride(next);
    setBusy(true);
    const r = await call("preview", only.file, next);
    setBusy(false);
    if (r.ok) patch(only.id, { preview: r.data });
  }

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setHits([]); return; }
    const res = await fetch(`/api/transformers/search?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({ results: [] }));
    setHits(data.results ?? []);
  }

  /** Import everything that is ready and not refused. One file at a time. */
  async function importAll() {
    setBusy(true); setError(null);
    const single = files.length === 1;
    const health: HealthUpdate[] = [];

    for (const f of files) {
      if (f.status !== "ready" || !f.preview) continue;
      if (!importableBlocks(f)) continue;

      patch(f.id, { status: "importing" });
      const r = await call("commit", f.file, override, { force: f.force, withChoices: single });
      if (r.ok) {
        patch(f.id, { status: "done", result: r.data });
        health.push(...(r.data.healthUpdates ?? []));
      } else {
        patch(f.id, { status: "failed", error: r.error });
      }
    }

    setBusy(false);
    setHealthMsg(healthToast(health));
    router.refresh();
  }

  const ready = files.filter((f) => f.status === "ready");
  const done = files.filter((f) => f.status === "done");
  const failed = files.filter((f) => f.status === "failed");
  const anythingToImport = ready.some(importableBlocks);
  const allSettled = files.length > 0 && files.every((f) => f.status === "done" || f.status === "failed");

  // ---------------------------------------------------------------- dropzone
  if (!files.length) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-white p-6">
          <input
            ref={fileRef} type="file" accept=".csv,.xlsx,.xls" multiple className="hidden"
            onChange={async (e) => {
              if (e.target.files?.length) await accept(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files?.length) await accept(e.dataTransfer.files);
            }}
          >
            <button
              onClick={() => fileRef.current?.click()} disabled={busy}
              className={`w-full rounded-xl border-2 border-dashed px-6 py-12 text-center transition disabled:opacity-50 ${
                dragging ? "border-kplc bg-kplc/10" : "border-line hover:border-kplc hover:bg-kplc/5"
              }`}
            >
              <span className="block text-3xl">⚡</span>
              <span className="mt-3 block text-sm font-bold text-navy">
                {busy ? "Reading…" : dragging ? "Drop the files" : "Drag files here, or click to choose"}
              </span>
              <span className="mt-1 block text-xs text-ink-soft">
                CSV or Excel, up to 40 MB each. Several at once is fine — each is read on its own.
                EMDis reports and plain column tables are both understood, the format detected
                automatically.
              </span>
            </button>
          </div>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  }

  // ---------------------------------------------------------------- results
  if (allSettled) {
    const matched = done.reduce((s, f) => s + (f.result?.datasets.filter((d) => d.matched && !d.staged).length ?? 0), 0);
    const stagedCount = done.reduce((s, f) => s + (f.result?.datasets.filter((d) => d.staged).length ?? 0), 0);
    const refused = done.reduce((s, f) => s + (f.result?.skipped.length ?? 0), 0);
    const readings = done.reduce((s, f) => s + (f.result?.totalReadings ?? 0), 0);
    const alerts = done.reduce(
      (s, f) => s + (f.result?.datasets.reduce((a, d) => a + d.alertsRaised, 0) ?? 0), 0,
    );

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-kplc/30 bg-kplc/5 p-6">
          <p className="text-sm font-bold text-navy">
            {files.length} file{files.length === 1 ? "" : "s"}. {matched} matched. {stagedCount} unmatched
            {refused > 0 && `. ${refused} refused as duplicate`}
            {failed.length > 0 && `. ${failed.length} unreadable`}.
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {readings.toLocaleString()} readings ingested · {alerts} alert{alerts === 1 ? "" : "s"} raised
            {stagedCount > 0 && " · unmatched data is held in staging and counts toward nothing until approved"}
          </p>

          {healthMsg && (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-navy">{healthMsg}</p>
          )}

          <ul className="mt-3 space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="text-xs">
                {f.status === "failed" ? (
                  <span className="text-red-700">❌ {f.file.name} — {f.error}</span>
                ) : (
                  <span className="text-navy">
                    ✅ {f.file.name} — {f.result?.totalReadings.toLocaleString() ?? 0} readings
                    {(f.result?.datasets.filter((d) => d.staged).length ?? 0) > 0 &&
                      `, ${f.result!.datasets.filter((d) => d.staged).length} staged`}
                    {(f.result?.skipped.length ?? 0) > 0 &&
                      `, ${f.result!.skipped.length} block(s) refused as duplicate`}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={reset} className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy">
              Upload more
            </button>
            {stagedCount > 0 && (
              <Link
                href="/manager/staging"
                className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark"
              >
                Review {stagedCount} staged dataset{stagedCount === 1 ? "" : "s"}
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------- many-file confirm
  if (files.length > 1) {
    return (
      <div className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-5 py-3">
          <span className="text-lg">📂</span>
          <span className="text-sm font-bold text-navy">{files.length} files</span>
          <span className="text-xs text-ink-soft">
            {ready.reduce((s, f) => s + (f.preview?.totalReadings ?? 0), 0).toLocaleString()} readings ·{" "}
            {ready.filter((f) => f.preview?.blocks.some((b) => b.match.transformerId)).length} matched ·{" "}
            {ready.filter((f) => f.preview?.blocks.every((b) => !b.match.transformerId)).length} unmatched
          </span>
        </div>

        <ul className="space-y-2">
          {files.map((f) => <FileRow key={f.id} f={f} onForce={(v) => patch(f.id, { force: v })} />)}
        </ul>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={importAll}
            disabled={busy || !anythingToImport}
            className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
          >
            {busy ? "Working…" : `✓ Import ${ready.filter(importableBlocks).length} file(s)`}
          </button>
          <button onClick={reset} disabled={busy} className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------ single-file confirm
  const only = files[0];
  if (only.status === "failed") {
    return (
      <div className="space-y-4">
        <ErrorBox>{only.error}</ErrorBox>
        <button onClick={reset} className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy">
          Try another file
        </button>
      </div>
    );
  }
  if (!only.preview) {
    return <p className="rounded-2xl border border-line bg-white px-5 py-8 text-sm text-ink-soft">Reading {only.file.name}…</p>;
  }

  const p = only.preview;
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
  const willStage = p.blocks.filter((b) => b.willStage).length;
  const importable = importableBlocks(only);

  return (
    <div className="space-y-4">
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-5 py-3">
        <span className="text-lg">📂</span>
        <span className="text-sm font-bold text-navy">{only.file.name}</span>
        {p.matchedProfile && (
          <span className="ml-auto rounded-full bg-kplc/10 px-3 py-1 text-[11px] font-bold text-kplc">
            Recognised as “{p.matchedProfile.name}”
          </span>
        )}
      </div>

      {/* Duplicate findings, before anything else — this is the one thing that
          can make the whole confirm screen moot. */}
      <DuplicatePanel blocks={p.blocks} force={only.force} onForce={(v) => patch(only.id, { force: v })} />

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
                  : `⚠️ Substation ${b.substationCode ?? "—"} · serial ${b.serial ?? "—"} — no register match; will be held in staging`}
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
                matches it. Attach it below, or let it go to staging for someone to match later.
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
              then re-upload — or let it stage and approve it once the asset exists.
            </p>
          </div>
        )}

        {willStage > 0 && !chosen && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            <strong>{willStage} block{willStage === 1 ? "" : "s"} will be staged, not imported.</strong> The
            readings are stored in full, but they count toward no transformer&apos;s analysis until someone
            names the unit on <Link href="/manager/staging" className="underline">the staging queue</Link>.
            Attaching load data to the wrong transformer is harder to undo than leaving it unattached.
          </p>
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
          onClick={importAll}
          disabled={busy || !importable}
          className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white hover:bg-kplc-dark disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : !importable
              ? "Nothing to import — every block is already in the register"
              : needsIdentity
                ? `✓ Confirm & stage for review (${p.totalReadings.toLocaleString()} readings)`
                : `✓ Confirm & import ${p.totalReadings.toLocaleString()} readings`}
        </button>
        <button onClick={reset} disabled={busy} className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-bold text-navy">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Is there anything left in this file worth importing?
 *
 * A file whose every block is an exact duplicate has nothing to contribute, and
 * the button should say so rather than run and report "0 readings ingested".
 * A block that is merely overlapping counts as importable, because the engineer
 * is allowed to decide that one.
 */
function importableBlocks(f: FileState): boolean {
  if (!f.preview) return false;
  return f.preview.blocks.some((b) => {
    if (!b.duplicate.blocked) return true;
    return b.duplicate.overridable && f.force;
  });
}

/** One row in the many-file list. */
function FileRow({ f, onForce }: { f: FileState; onForce: (v: boolean) => void }) {
  const p = f.preview;
  const worst = p?.blocks.find((b) => b.duplicate.verdict !== "CLEAR")?.duplicate ?? null;
  const staged = p?.blocks.filter((b) => b.willStage).length ?? 0;
  const matched = p?.blocks.filter((b) => b.match.transformerId).length ?? 0;

  return (
    <li className="rounded-2xl border border-line bg-white px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">
          {f.status === "failed" ? "❌" : f.status === "done" ? "✅" : f.status === "ready" ? "📄" : "⏳"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-navy">{f.file.name}</span>
        {p && (
          <span className="text-xs text-ink-soft">
            {p.totalReadings.toLocaleString()} readings · {matched} matched
            {staged > 0 && ` · ${staged} unmatched`}
          </span>
        )}
        {f.status === "reading" && <span className="text-xs text-ink-soft">reading…</span>}
        {f.status === "importing" && <span className="text-xs text-ink-soft">importing…</span>}
      </div>

      {f.error && <p className="mt-1.5 text-xs font-semibold text-red-700">{f.error}</p>}

      {worst && worst.verdict !== "CLEAR" && (
        <div
          className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
            worst.overridable ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <strong>{VERDICT_LABEL[worst.verdict] ?? worst.verdict}.</strong>{" "}
          {worst.findings[0]?.reason}
          {worst.overridable && (
            <label className="mt-1.5 flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={f.force} onChange={(e) => onForce(e.target.checked)} />
              Import anyway
            </label>
          )}
        </div>
      )}
    </li>
  );
}

/** The duplicate verdict for a single-file confirm screen, block by block. */
function DuplicatePanel({
  blocks, force, onForce,
}: {
  blocks: Block[];
  force: boolean;
  onForce: (v: boolean) => void;
}) {
  const flagged = blocks.filter((b) => b.duplicate.verdict !== "CLEAR");
  if (!flagged.length) return null;

  const hard = flagged.some((b) => b.duplicate.blocked && !b.duplicate.overridable);
  const overridable = flagged.some((b) => b.duplicate.overridable);

  return (
    <div
      className={`rounded-2xl border p-5 ${
        hard ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"
      }`}
    >
      <h3 className={`text-sm font-bold ${hard ? "text-red-900" : "text-amber-900"}`}>
        {hard ? "Already in the register" : "Overlaps data already held"}
      </h3>
      <ul className={`mt-2 space-y-2 text-xs ${hard ? "text-red-800" : "text-amber-900"}`}>
        {flagged.map((b, i) => (
          <li key={i}>
            <strong>
              {b.match.label ? `G-${b.match.label}` : b.substationCode ?? "This block"} —{" "}
              {VERDICT_LABEL[b.duplicate.verdict] ?? b.duplicate.verdict}.
            </strong>{" "}
            {b.duplicate.findings[0]?.reason}
          </li>
        ))}
      </ul>

      {hard && (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-red-800">
          An exact duplicate is refused and cannot be forced. Importing identical readings a second
          time cannot make the register more accurate — it can only double the totals that are built
          by adding up, such as minutes spent over rated current.
        </p>
      )}

      {overridable && (
        <label className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-navy">
          <input type="checkbox" checked={force} onChange={(e) => onForce(e.target.checked)} />
          Import anyway — I know this overlaps and want both copies kept
        </label>
      )}
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
