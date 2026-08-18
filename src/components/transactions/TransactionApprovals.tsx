"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";

export type PendingMovement = {
  id: string;
  transformerId: string;
  label: string;
  movementLabel: string;
  fromName: string;
  toName: string;
  purpose: string;
  vehiclePlate: string | null;
  driverName: string | null;
  initiatedByName: string;
  initiatedById: string;
  initiatedAt: string; // ISO
  batchRef: string | null;
  notes: string | null;
  canApprove: boolean;
  blockedReason: string | null;
};

/**
 * The manager's movement queue.
 *
 * A row the viewer raised themselves is shown with its checkbox disabled and
 * the reason on the row, rather than hidden — a queue whose count does not
 * match its contents is a queue people stop trusting. The server re-checks the
 * same rule per record.
 */
export function TransactionApprovals({ movements }: { movements: PendingMovement[] }) {
  const router = useRouter();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectable = movements.filter((m) => m.canApprove);
  const allSelected = selectable.length > 0 && selectable.every((m) => selected.has(m.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function decide(decision: "APPROVE" | "REJECT") {
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one movement.");
      return;
    }
    if (decision === "REJECT" && reason.trim().length < 3) {
      setError("Say why they are being refused.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/transactions/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: [...selected], decision, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not record the decision.");
        return;
      }
      toast(data.message, data.skipped?.length ? "error" : "success");
      setSelected(new Set());
      setReason("");
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  if (movements.length === 0) {
    return <EmptyState message="No movements are waiting for a decision." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <label className="flex items-center gap-2 text-xs font-bold text-navy">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((m) => m.id)))}
            disabled={busy || selectable.length === 0}
            className="h-4 w-4"
          />
          Select all approvable ({selectable.length})
        </label>
        <span className="text-xs text-ink-soft">{selected.size} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required to refuse)"
            className={`${inputClass} w-56 py-2 text-xs`}
          />
          <button
            type="button"
            onClick={() => decide("APPROVE")}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-ink-soft/40"
          >
            {busy ? "Working…" : `Approve ${selected.size || ""}`.trim()}
          </button>
          <button
            type="button"
            onClick={() => decide("REJECT")}
            disabled={busy || selected.size === 0}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refuse {selected.size || ""}
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {movements.map((m) => (
          <li key={m.id} className={`flex items-start gap-3 px-4 py-3 ${m.canApprove ? "" : "bg-surface/60"}`}>
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              disabled={!m.canApprove || busy}
              title={m.blockedReason ?? undefined}
              className="mt-1 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/transformers/${m.transformerId}`} className="text-sm font-bold text-navy hover:text-kplc">
                  {m.label}
                </Link>
                <Badge tone="warning">{m.movementLabel}</Badge>
                {m.batchRef && <span className="text-[11px] font-semibold text-ink-soft">{m.batchRef}</span>}
              </div>
              <p className="mt-0.5 text-xs text-ink-soft">
                {m.fromName} → {m.toName} · {m.purpose.toLowerCase()}
                {m.vehiclePlate ? ` · ${m.vehiclePlate}` : ""}
                {m.driverName ? ` · ${m.driverName}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Raised by {m.initiatedByName} · {formatRelative(new Date(m.initiatedAt))}
              </p>
              {m.notes && <p className="mt-1 text-xs text-ink">{m.notes}</p>}
              {m.blockedReason && (
                <p className="mt-1 text-[11px] font-semibold text-amber-700">{m.blockedReason}</p>
              )}
            </div>
            <Link
              href={`/transactions/${m.id}`}
              className="shrink-0 inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline"
            >
              Details
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
