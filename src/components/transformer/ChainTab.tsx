"use client";

import { useState } from "react";
import type { StoryEvent } from "./story-types";
import { EVENT_META, formatDateTime } from "@/lib/format";

type Verification = {
  valid: boolean;
  checked: number;
  brokenAtEventId: string | null;
  reason: string | null;
};

/**
 * The custody chain, laid out link by link, with a button that re-runs the
 * verification live.
 *
 * The "Verify" button hits the server, which recomputes every hash from
 * scratch — it is not reading a cached flag. That is the whole demo: edit a row
 * in the database, press this button, watch it turn red and name the exact
 * event.
 */
export function ChainTab({
  transformerId,
  events,
  initial,
}: {
  transformerId: string;
  events: StoryEvent[]; // newest first
  initial: Verification;
}) {
  const [result, setResult] = useState<Verification>(initial);
  const [busy, setBusy] = useState(false);

  // Oldest first: a chain reads from genesis forward.
  const chronological = [...events].reverse();

  async function verify() {
    setBusy(true);
    try {
      const response = await fetch(`/api/transformers/${transformerId}/verify`);
      if (response.ok) setResult(await response.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* --- Verdict ------------------------------------------------------ */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 ${
          result.valid
            ? "border-emerald-200 bg-emerald-50"
            : "border-red-200 bg-red-50"
        }`}
      >
        <div>
          <p
            className={`text-base font-bold ${
              result.valid ? "text-emerald-800" : "text-red-800"
            }`}
          >
            {result.valid
              ? `Chain verified — ${result.checked} events, unbroken`
              : "Chain broken — this record has been tampered with"}
          </p>
          <p
            className={`mt-1 text-sm ${
              result.valid ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {result.valid
              ? "Every event's hash matches its contents and links to the one before it."
              : (result.reason ?? "A hash does not match.")}
          </p>
        </div>
        <button
          type="button"
          onClick={verify}
          disabled={busy}
          className="rounded-xl bg-navy px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-navy-dark disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify full chain"}
        </button>
      </div>

      {/* --- The links --------------------------------------------------- */}
      <ol className="space-y-2">
        {chronological.map((event, index) => {
          const broken = result.brokenAtEventId === event.id;
          return (
            <li
              key={event.id}
              className={`rounded-xl border p-4 ${
                broken ? "border-red-300 bg-red-50" : "border-line bg-white"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[11px] font-bold text-ink-soft">
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold text-navy">
                    {EVENT_META[event.type].label}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {formatDateTime(event.occurredAt)}
                  </span>
                </div>
                {result.valid ? (
                  <span className="text-xs font-bold text-emerald-600">✓ verified</span>
                ) : broken ? (
                  <span className="text-xs font-bold text-red-600">✕ hash mismatch</span>
                ) : null}
              </div>

              <div className="mt-2 flex items-center gap-2 overflow-x-auto font-mono text-[11px] text-ink-soft">
                <span className="shrink-0">
                  {event.prevHash ? `…${event.prevHash.slice(-10)}` : "genesis"}
                </span>
                <span className="shrink-0 text-kplc">→</span>
                <span className="shrink-0 font-bold text-navy">…{event.hash.slice(-10)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
