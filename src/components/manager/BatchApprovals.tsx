"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";

export type PendingBatch = {
  id: string;
  batchRef: string;
  manufacturerName: string;
  storeName: string | null;
  declared: number;
  entered: number;
  tested: number;
  untested: number;
  receivedByName: string;
  receivedAt: string;
  notes: string | null;
  canApprove: boolean;
  blockedReason: string | null;
  units: { id: string; label: string; ratingKva: number; sampleTested: boolean }[];
};

export function BatchApprovals({ batches }: { batches: PendingBatch[] }) {
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(batchId: string, decision: "APPROVE" | "REJECT") {
    setError(null);
    if (decision === "REJECT" && reason.trim().length < 3) {
      setError("Say why the consignment is being refused.");
      return;
    }
    setBusy(batchId);
    try {
      const res = await fetch("/api/batches/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, decision, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not record the decision.");
        return;
      }
      toast(data.message, data.untestedReleased ? "error" : "success");
      setReason("");
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  if (batches.length === 0) {
    return <EmptyState message="No consignment is waiting for a decision." />;
  }

  return (
    <div className="space-y-4">
      {error && <FormError message={error} />}
      {batches.map((b) => (
        <div key={b.id} className="rounded-2xl border border-line bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <span className="font-mono text-sm font-bold text-navy">{b.batchRef}</span>
            <Badge tone="warning">Pending</Badge>
            {b.untested > 0 && <Badge tone="danger">{b.untested} untested</Badge>}
            <span className="ml-auto text-xs text-ink-soft">{formatRelative(new Date(b.receivedAt))}</span>
          </div>

          <div className="px-5 py-3">
            <p className="text-sm font-semibold text-navy">
              {b.entered} {b.manufacturerName} transformers · {b.tested} tested · {b.untested} to be
              released untested
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              Booked in by {b.receivedByName}
              {b.storeName ? ` at ${b.storeName}` : ""}
            </p>

            {b.declared !== b.entered && (
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                Delivery note says {b.declared}, {b.entered} were entered. Resolve that before
                releasing — a missing unit is easier to find today than next month.
              </p>
            )}

            {b.untested > 0 && (
              <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
                ⚠️ Approving releases {b.untested}{" "}
                {b.untested === 1 ? "transformer that has" : "transformers that have"} never been
                tested. They stay flagged for life, and the field engineer installing them is warned.
              </p>
            )}

            {b.notes && <p className="mt-2 text-xs text-ink">{b.notes}</p>}

            <button
              type="button"
              onClick={() => setOpenId(openId === b.id ? null : b.id)}
              className="mt-2 text-xs font-bold text-kplc hover:underline"
            >
              {openId === b.id ? "Hide" : "Show"} the {b.entered} units
            </button>

            {openId === b.id && (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {b.units.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span>{u.sampleTested ? "🧪" : "⚠️"}</span>
                    <Link href={`/transformers/${u.id}`} className="flex-1 truncate font-semibold text-navy hover:text-kplc">
                      {u.label}
                    </Link>
                    <span className="text-ink-soft">{u.ratingKva} kVA</span>
                    <span className={u.sampleTested ? "font-bold text-emerald-700" : "font-bold text-amber-700"}>
                      {u.sampleTested ? "tested" : "untested"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {b.blockedReason ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                {b.blockedReason}
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (required to refuse)"
                  className={`${inputClass} w-56 py-2 text-xs`}
                />
                <button
                  type="button"
                  onClick={() => decide(b.id, "APPROVE")}
                  disabled={busy === b.id}
                  className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy === b.id ? "Working…" : `Release all ${b.entered}`}
                </button>
                <button
                  type="button"
                  onClick={() => decide(b.id, "REJECT")}
                  disabled={busy === b.id}
                  className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
                >
                  Refuse
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
