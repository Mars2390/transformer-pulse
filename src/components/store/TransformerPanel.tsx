"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import type { TransformerStatus, EventType } from "@/generated/prisma/enums";
import { EVENT_META, STATUS_META, formatDate, formatRating, formatRelative } from "@/lib/format";

type Summary = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  manufacturer: string;
  ratingKva: number;
  status: TransformerStatus;
  receivedAtISO: string;
  lastTest: { passed: boolean; stage: string; testedAtISO: string } | null;
  warranty: { label: string; state: string };
  recentEvents: { id: string; type: EventType; userName: string; occurredAtISO: string }[];
};

/**
 * The quick-view panel. Slides in from the right when a store keeper clicks a
 * row, so they can see a unit's state and jump to an action without leaving the
 * inventory. Escape and a backdrop click close it.
 */
export function TransformerPanel({
  transformerId,
  onClose,
}: {
  transformerId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!transformerId) return;

    setData(null);
    setLoading(true);
    const controller = new AbortController();

    fetch(`/api/transformers/${transformerId}/summary`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [transformerId]);

  useEffect(() => {
    if (!transformerId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [transformerId, onClose]);

  const open = transformerId != null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-navy-dark/40 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-line bg-surface shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        {open && (
          <div className="flex min-h-full flex-col">
            <div className="flex items-center justify-between border-b border-line bg-white px-5 py-4">
              <h2 className="text-sm font-bold text-navy">Quick view</h2>
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-navy"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {loading || !data ? (
              <div className="flex-1 space-y-3 p-5">
                <div className="h-8 w-2/3 animate-pulse rounded-lg bg-surface-2" />
                <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
                <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
              </div>
            ) : (
              <div className="flex-1 space-y-5 p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xl font-extrabold text-navy">
                      {data.gNumber ?? data.serialNumber}
                    </span>
                    <Badge tone={STATUS_META[data.status].tone}>
                      {STATUS_META[data.status].label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {formatRating(data.ratingKva)} · {data.manufacturer}
                  </p>
                  {data.gNumber && (
                    <p className="font-mono text-xs text-ink-soft">{data.serialNumber}</p>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-line bg-white p-3">
                    <dt className="text-[10px] font-bold tracking-wide text-ink-soft">RECEIVED</dt>
                    <dd className="mt-1 text-sm font-semibold text-navy">
                      {formatDate(data.receivedAtISO)}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-line bg-white p-3">
                    <dt className="text-[10px] font-bold tracking-wide text-ink-soft">WARRANTY</dt>
                    <dd className="mt-1 text-sm font-semibold text-navy">{data.warranty.label}</dd>
                  </div>
                  <div className="col-span-2 rounded-xl border border-line bg-white p-3">
                    <dt className="text-[10px] font-bold tracking-wide text-ink-soft">LAST TEST</dt>
                    <dd className="mt-1">
                      {data.lastTest ? (
                        <span className="flex items-center gap-2">
                          <Badge tone={data.lastTest.passed ? "success" : "danger"}>
                            {data.lastTest.passed ? "Passed" : "Failed"}
                          </Badge>
                          <span className="text-xs text-ink-soft">
                            {formatDate(data.lastTest.testedAtISO)}
                          </span>
                        </span>
                      ) : (
                        <Badge tone="warning">Not tested</Badge>
                      )}
                    </dd>
                  </div>
                </dl>

                <div>
                  <p className="text-[11px] font-bold tracking-wide text-ink-soft">RECENT EVENTS</p>
                  <ul className="mt-2 space-y-2">
                    {data.recentEvents.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 rounded-lg bg-white p-2.5">
                        <Badge tone={EVENT_META[e.type].tone}>{EVENT_META[e.type].label}</Badge>
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                          {e.userName}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-soft">
                          {formatRelative(e.occurredAtISO)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Actions relevant to the unit's current state. */}
                <div className="space-y-2 border-t border-line pt-4">
                  {data.status === "IN_STORE" && (
                    <>
                      {(!data.lastTest || data.lastTest.stage !== "STORE_INTAKE") && (
                        <Link
                          href={`/store/test/${data.id}`}
                          className="block rounded-xl bg-kplc py-3 text-center text-sm font-bold text-white transition-colors hover:bg-kplc-light"
                        >
                          Record intake test
                        </Link>
                      )}
                      {data.lastTest?.passed && (
                        <Link
                          href={`/store/dispatch/${data.id}`}
                          className="block rounded-xl bg-gold py-3 text-center text-sm font-bold text-navy-dark transition-colors hover:bg-gold-dark"
                        >
                          Dispatch to field
                        </Link>
                      )}
                    </>
                  )}
                  <Link
                    href={`/transformers/${data.id}`}
                    className="block rounded-xl border border-line bg-white py-3 text-center text-sm font-bold text-navy transition-colors hover:border-navy/30"
                  >
                    View full story →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
