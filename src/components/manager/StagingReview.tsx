"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Unit = {
  key: string;
  gNumber: string | null;
  serial: string | null;
  substationCode: string;
  substationName: string | null;
  make: string | null;
  ratingKva: number | null;
  yom: number | null;
  region: string | null;
  locationNote: string | null;
  lastInspectedOn: string;
  inspectorRef: string;
  structure: string | null;
  visits: number;
  blockers: string[];
  warnings: string[];
};

type Totals = {
  total: number; promotable: number; blocked: number;
  withGNumber: number; withSerial: number; withWarnings: number;
};

const BATCH = 50;

export function StagingReview() {
  const router = useRouter();
  const [units, setUnits] = useState<Unit[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"promotable" | "blocked" | "noG" | "warnings" | "all">("promotable");
  const [search, setSearch] = useState("");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, promoted: 0, skipped: 0, failed: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/inspections/staged");
    const data = await res.json();
    setUnits(data.units ?? []);
    setTotals(data.totals ?? null);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units.filter((u) => {
      if (filter === "promotable" && u.blockers.length) return false;
      if (filter === "blocked" && !u.blockers.length) return false;
      if (filter === "noG" && u.gNumber) return false;
      if (filter === "warnings" && !u.warnings.length) return false;
      if (!q) return true;
      return [u.gNumber, u.serial, u.substationCode, u.substationName, u.make, u.locationNote]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [units, filter, search]);

  const selectable = shown.filter((u) => !u.blockers.length);
  const allShownSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.key));

  function toggleAll() {
    const next = new Set(selected);
    if (allShownSelected) selectable.forEach((u) => next.delete(u.key));
    else selectable.forEach((u) => next.add(u.key));
    setSelected(next);
  }

  async function promote() {
    const keys = [...selected];
    if (!keys.length) return;
    setRunning(true);
    setFinished(false);
    setLog([]);
    setProgress({ done: 0, total: keys.length, promoted: 0, skipped: 0, failed: 0 });

    let promoted = 0, skipped = 0, failed = 0;

    for (let i = 0; i < keys.length; i += BATCH) {
      const slice = keys.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/inspections/promote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys: slice }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "batch failed");

        promoted += data.promoted; skipped += data.skipped; failed += data.failed;
        setProgress({ done: Math.min(i + BATCH, keys.length), total: keys.length, promoted, skipped, failed });

        const notes = (data.details ?? [])
          .filter((d: { outcome: string }) => d.outcome !== "PROMOTED")
          .slice(0, 3)
          .map((d: { key: string; reason?: string }) => `${d.key}: ${d.reason}`);
        if (notes.length) setLog((l) => [...l, ...notes].slice(-40));
      } catch (e) {
        failed += slice.length;
        setProgress({ done: Math.min(i + BATCH, keys.length), total: keys.length, promoted, skipped, failed });
        setLog((l) => [...l, `Batch failed: ${e instanceof Error ? e.message : "unknown"}`].slice(-40));
      }
    }

    setRunning(false);
    setFinished(true);
    setSelected(new Set());
    await load();
    router.refresh();
  }

  if (loading) return <p className="text-sm text-ink-soft">Loading staged inspections…</p>;

  if (!units.length && !finished) {
    return (
      <div className="rounded-2xl border border-line bg-white p-10 text-center">
        <p className="text-sm font-bold text-navy">Nothing staged</p>
        <p className="mt-1 text-xs text-ink-soft">
          Every imported inspection has found its transformer.
        </p>
      </div>
    );
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* --- Progress ------------------------------------------------------- */}
      {(running || finished) && (
        <div className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-navy">
              {running ? `Promoting ${progress.done} of ${progress.total}…` : "Promotion complete"}
            </p>
            <p className="text-xs text-ink-soft">
              {progress.promoted} promoted · {progress.skipped} skipped · {progress.failed} failed
            </p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-kplc transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {log.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold text-ink-soft">
                {log.length} note{log.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] text-ink-soft">
                {log.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </details>
          )}
          {finished && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/transformers" className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white">
                Browse the register
              </Link>
              <Link href="/manager/dashboard" className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy">
                Dashboard
              </Link>
            </div>
          )}
        </div>
      )}

      {/* --- Counts --------------------------------------------------------- */}
      {totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Staged units" value={totals.total} />
          <Tile label="Ready" value={totals.promotable} tone="good" />
          <Tile label="Blocked" value={totals.blocked} tone="bad" hint="missing rating or year" />
          <Tile label="With G-Number" value={totals.withGNumber} />
          <Tile label="With warnings" value={totals.withWarnings} tone="warn" />
        </div>
      )}

      {/* --- Why some are blocked ------------------------------------------- */}
      {totals && totals.blocked > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          <strong>{totals.blocked} units cannot be promoted.</strong> No inspection recorded a usable
          rating or year of manufacture for them. Rating drives every loading figure and year drives the
          age term in the health score — promoting with a guess would present that guess as measurement.
          They stay staged until an engineer supplies the missing value.
        </p>
      )}

      {/* --- Controls -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ["promotable", "Ready"],
          ["blocked", "Blocked"],
          ["noG", "No G-Number"],
          ["warnings", "Has warnings"],
          ["all", "All"],
        ] as const).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === f ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"}`}
          >
            {label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search substation, serial, place…"
          className="min-w-[200px] flex-1 rounded-lg border border-line px-3 py-1.5 text-xs outline-none focus:border-kplc"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3">
        <label className="flex items-center gap-2 text-xs font-bold text-navy">
          <input type="checkbox" checked={allShownSelected} onChange={toggleAll} disabled={running || !selectable.length} />
          Select all shown ({selectable.length})
        </label>
        <span className="text-xs text-ink-soft">{selected.size} selected</span>
        <button
          onClick={promote}
          disabled={running || !selected.size}
          className="ml-auto rounded-xl bg-kplc px-5 py-2.5 text-sm font-bold text-white hover:bg-kplc-dark disabled:opacity-40"
        >
          {running ? "Promoting…" : `Promote ${selected.size || ""} selected`}
        </button>
      </div>

      {/* --- Table ----------------------------------------------------------- */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">G-Number</th>
              <th className="px-3 py-2">Serial</th>
              <th className="px-3 py-2">Substation</th>
              <th className="px-3 py-2">Make</th>
              <th className="px-3 py-2">Rating</th>
              <th className="px-3 py-2">Year</th>
              <th className="px-3 py-2">Visits</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.slice(0, 400).map((u) => {
              const blocked = u.blockers.length > 0;
              return (
                <tr key={u.key} className={blocked ? "bg-red-50/40" : u.warnings.length ? "bg-amber-50/40" : undefined}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={blocked || running}
                      checked={selected.has(u.key)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        e.target.checked ? next.add(u.key) : next.delete(u.key);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {u.gNumber ?? <span className="text-amber-700">will be staged</span>}
                  </td>
                  <td className="max-w-[130px] truncate px-3 py-2 font-mono">
                    {u.serial ?? <span className="text-ink-soft">—</span>}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2">
                    {u.substationCode}{u.substationName ? ` — ${u.substationName}` : ""}
                  </td>
                  <td className="px-3 py-2">{u.make ?? <span className="text-ink-soft">—</span>}</td>
                  <td className="px-3 py-2">{u.ratingKva ? `${u.ratingKva} kVA` : <span className="font-bold text-red-700">none</span>}</td>
                  <td className="px-3 py-2">{u.yom ?? <span className="font-bold text-red-700">none</span>}</td>
                  <td className="px-3 py-2">{u.visits}</td>
                  <td className="px-3 py-2">{u.lastInspectedOn}</td>
                  <td className="px-3 py-2">
                    {blocked ? (
                      <span className="text-[11px] font-bold text-red-700">{u.blockers[0]}</span>
                    ) : u.warnings.length ? (
                      <span className="text-[11px] text-amber-800">{u.warnings[0]}</span>
                    ) : (
                      <span className="text-[11px] font-bold text-kplc">ready</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length > 400 && (
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-soft">
            Showing the first 400 of {shown.length}. &ldquo;Select all shown&rdquo; selects every match, not just these.
          </p>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-soft">
        Each promotion writes a transformer and a sealed <strong>ONBOARDED_EXISTING</strong> genesis event
        carrying the substation, the inspection history and the inspector who recorded it. Units arrive
        <strong> unverified</strong> and stay that way until a field engineer stands at the asset.
        The register holds no coordinates, so these do not appear on the map until someone surveys them.
      </p>
    </div>
  );
}

function Tile({ label, value, tone = "mute", hint }: { label: string; value: number; tone?: "good" | "warn" | "bad" | "mute"; hint?: string }) {
  const c = { good: "text-kplc", warn: "text-amber-700", bad: "text-red-700", mute: "text-navy" }[tone];
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-[11px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className={`mt-1 text-2xl font-extrabold ${c}`}>{value}</p>
      {hint && <p className="text-[10px] text-ink-soft">{hint}</p>}
    </div>
  );
}
