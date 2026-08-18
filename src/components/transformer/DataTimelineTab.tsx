"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TimelineEntry, TimelineKind, EmdisPeriod, EmdisTrend, InspectionTrend } from "@/lib/data-timeline";

const KIND_META: Record<TimelineKind, { label: string; icon: string }> = {
  EMDIS_UPLOAD: { label: "EMDis", icon: "📊" },
  INSPECTION: { label: "Inspection", icon: "📋" },
  TEST: { label: "Test", icon: "🧪" },
  MOVEMENT: { label: "Movement", icon: "🚚" },
  REPAIR: { label: "Repair", icon: "🔧" },
  EVENT: { label: "Event", icon: "•" },
};

const TONE: Record<TimelineEntry["tone"], string> = {
  neutral: "border-line",
  info: "border-blue-300",
  success: "border-kplc/40",
  warning: "border-amber-300",
  danger: "border-red-300",
};

/**
 * Every dated record about one transformer, on one axis, newest first.
 *
 * The value is in the juxtaposition rather than any single row: an inspector
 * writing "overloaded, RELIEVE" nine days before a meter measures a phase at
 * 121% is a story neither source tells alone, and until these sat on the same
 * axis nobody could see it.
 */
export function DataTimelineTab({
  entries,
  trend,
  inspectionTrend,
}: {
  entries: TimelineEntry[];
  trend: EmdisTrend;
  inspectionTrend: InspectionTrend;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Set<TimelineKind>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const shown = useMemo(
    () => (kinds.size === 0 ? entries : entries.filter((e) => kinds.has(e.kind))),
    [entries, kinds],
  );

  const counts = useMemo(() => {
    const c = new Map<TimelineKind, number>();
    for (const e of entries) c.set(e.kind, (c.get(e.kind) ?? 0) + 1);
    return c;
  }, [entries]);

  const toggleKind = (k: TimelineKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const toggleDataset = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const comparable = trend.periods.filter((p) => selected.has(p.datasetId));

  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-soft">
        Nothing dated has been recorded against this transformer yet. Uploads, inspections, tests,
        movements and repairs all land here in the order they happened.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {trend.periods.length > 1 && (
        <div className="rounded-2xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-navy">Compare load periods</h3>
            <p className="text-xs text-ink-soft">
              {selected.size === 0
                ? "All periods. Tick two or more to compare them directly."
                : `${selected.size} selected`}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {trend.periods.map((p) => (
              <label
                key={p.datasetId}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-bold ${
                  selected.has(p.datasetId) ? "border-kplc bg-kplc/5 text-navy" : "border-line bg-white text-ink-soft"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.datasetId)}
                  onChange={() => toggleDataset(p.datasetId)}
                  className="h-5 w-5"
                />
                {p.firstReadingAt.slice(0, 7)}
                {p.peakPhasePct != null && (
                  <span className={p.peakPhasePct >= 100 ? "text-red-700" : "text-ink-soft"}>
                    {p.peakPhasePct}%
                  </span>
                )}
              </label>
            ))}
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="inline-flex min-h-11 items-center px-2 text-xs font-bold text-kplc hover:underline"
              >
                All periods
              </button>
            )}
          </div>

          <PeriodTable periods={comparable.length >= 1 ? comparable : trend.periods} />

          {inspectionTrend.changes.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-[11px] font-extrabold tracking-[0.08em] text-amber-900">
                WHAT CHANGED BETWEEN INSPECTIONS
              </p>
              <ul className="mt-1.5 space-y-1">
                {inspectionTrend.changes.map((c) => (
                  <li key={c} className="text-xs text-amber-900">{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setKinds(new Set())}
          className={`inline-flex min-h-11 items-center rounded-lg px-4 text-xs font-bold ${
            kinds.size === 0 ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"
          }`}
        >
          Everything {entries.length}
        </button>
        {([...counts.entries()] as [TimelineKind, number][]).map(([k, count]) => (
          <button
            key={k}
            type="button"
            onClick={() => toggleKind(k)}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-xs font-bold ${
              kinds.has(k) ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"
            }`}
          >
            {KIND_META[k].icon} {KIND_META[k].label} {count}
          </button>
        ))}
      </div>

      <ol className="space-y-2">
        {shown.map((e) => {
          const expanded = open === e.id;
          return (
            <li key={e.id} className={`overflow-hidden rounded-xl border-l-4 bg-white ${TONE[e.tone]} border-y border-r border-y-line border-r-line`}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : e.id)}
                className="flex w-full min-h-11 items-start gap-3 px-4 py-3 text-left hover:bg-surface-2"
              >
                <span className="mt-0.5 shrink-0 text-base">{KIND_META[e.kind].icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-bold text-navy">{e.title}</span>
                    <span className="font-mono text-[11px] text-ink-soft">{e.occurredAt.slice(0, 10)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{e.summary}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-soft">{expanded ? "▲" : "▼"}</span>
              </button>

              {expanded && (
                <div className="border-t border-line bg-surface-2 px-4 py-3">
                  <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                    {e.detail.map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-xs">
                        <dt className="shrink-0 font-semibold text-ink-soft">{k}</dt>
                        <dd className="min-w-0 flex-1 break-words text-navy">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {e.href && (
                    <Link
                      href={e.href}
                      className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-kplc px-4 text-xs font-bold text-white hover:bg-kplc-dark"
                    >
                      Open the full record
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PeriodTable({ periods }: { periods: EmdisPeriod[] }) {
  if (periods.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="border-b border-line text-[11px] font-bold text-ink-soft">
          <tr>
            <th className="py-2 pr-3">Period</th>
            <th className="py-2 pr-3">Peak phase</th>
            <th className="py-2 pr-3">Worst phase</th>
            <th className="py-2 pr-3">Avg kVA</th>
            <th className="py-2 pr-3">Min volts</th>
            <th className="py-2 pr-3">Readings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {periods.map((p) => (
            <tr key={p.datasetId} className={p.peakPhasePct != null && p.peakPhasePct >= 100 ? "bg-red-50/60" : undefined}>
              <td className="py-2 pr-3 font-semibold text-navy">
                {p.firstReadingAt.slice(0, 10)} → {p.lastReadingAt.slice(0, 10)}
              </td>
              <td className={`py-2 pr-3 font-bold ${p.peakPhasePct == null ? "text-ink-soft" : p.peakPhasePct >= 100 ? "text-red-700" : p.peakPhasePct >= 80 ? "text-amber-700" : "text-kplc"}`}>
                {p.peakPhasePct != null ? `${p.peakPhasePct}%` : "not measured"}
              </td>
              <td className="py-2 pr-3 text-ink-soft">{p.peakPhase ?? "—"}</td>
              <td className="py-2 pr-3 text-ink-soft">{p.avgKva != null ? p.avgKva.toFixed(1) : "—"}</td>
              <td className="py-2 pr-3 text-ink-soft">{p.minVoltage != null ? p.minVoltage.toFixed(0) : "—"}</td>
              <td className="py-2 pr-3 text-ink-soft">{p.readingCount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
