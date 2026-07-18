"use client";

import Link from "next/link";
import { useState } from "react";

type Result = {
  checkedTransformers: number;
  checkedEvents: number;
  valid: boolean;
  broken: { id: string; label: string; reason: string }[];
};

/**
 * Runs the system-wide chain verification and shows the verdict. The button
 * calls the server, which recomputes every hash of every transformer from
 * scratch — this is the live proof, not a cached badge.
 */
export function ChainVerifier() {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/verify-all");
      if (res.ok) setResult(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={verify}
        disabled={busy}
        className="rounded-xl bg-navy px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-navy-dark disabled:opacity-50"
      >
        {busy ? "Verifying every chain…" : "Verify all chains"}
      </button>

      {result && (
        <div
          className={`rounded-2xl border p-6 ${
            result.valid ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
          }`}
        >
          <p className={`text-lg font-bold ${result.valid ? "text-emerald-800" : "text-red-800"}`}>
            {result.valid
              ? `All ${result.checkedTransformers} transformers verified. Chains unbroken.`
              : `${result.broken.length} transformer${result.broken.length === 1 ? "" : "s"} with a broken chain.`}
          </p>
          <p className={`mt-1 text-sm ${result.valid ? "text-emerald-700" : "text-red-700"}`}>
            {result.checkedEvents} events checked across {result.checkedTransformers} transformers.
          </p>

          {!result.valid && (
            <ul className="mt-4 space-y-2">
              {result.broken.map((b) => (
                <li key={b.id} className="rounded-xl border border-red-200 bg-white p-3">
                  <Link href={`/transformers/${b.id}`} className="font-mono text-sm font-bold text-red-700 hover:underline">
                    {b.label}
                  </Link>
                  <p className="mt-0.5 text-xs text-red-600">{b.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
