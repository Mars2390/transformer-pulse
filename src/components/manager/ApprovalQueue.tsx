"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatRating, formatRelative } from "@/lib/format";

export type PendingUnit = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  manufacturerName: string;
  storeName: string | null;
  submittedByName: string | null;
  submittedById: string | null;
  submittedAt: string | null; // ISO
};

/**
 * The checker's queue.
 *
 * Two things here are deliberate. First, a unit the current user booked in is
 * shown but not selectable, with the reason written on the row — hiding it
 * would leave a checker wondering why the count on the dashboard does not match
 * the list. Second, the server re-checks the same rule per transformer, because
 * a disabled checkbox is a courtesy and not a control.
 */
export function ApprovalQueue({
  units,
  viewerId,
}: {
  units: PendingUnit[];
  viewerId: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownUnits = units.filter((u) => u.submittedById === viewerId);
  const selectable = units.filter((u) => u.submittedById !== viewerId);
  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)));
  }

  async function decide(decision: "APPROVE" | "REJECT") {
    setError(null);

    if (selected.size === 0) {
      setError("Select at least one transformer.");
      return;
    }
    if (decision === "REJECT" && reason.trim().length < 3) {
      setError("Say why they are being rejected. A rejection with no reason cannot be acted on.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/transformers/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transformerIds: [...selected],
          decision,
          reason: reason.trim() || undefined,
        }),
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

  if (units.length === 0) {
    return <EmptyState message="Nothing is waiting for approval. Every booked-in unit has been accepted or rejected." />;
  }

  return (
    <div className="space-y-4">
      {ownUnits.length > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          {ownUnits.length === 1 ? "One unit below was" : `${ownUnits.length} units below were`} booked
          in by you and cannot be approved by you. Someone else has to accept
          {ownUnits.length === 1 ? " it" : " them"}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <label className="flex items-center gap-2 text-xs font-bold text-navy">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
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
            placeholder="Reason (required to reject)"
            className={`${inputClass} w-56 py-2 text-xs`}
          />
          <button
            type="button"
            onClick={() => decide("APPROVE")}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-ink-soft/40"
          >
            {busy ? "Working…" : `Approve ${selected.size || ""}`.trim()}
          </button>
          <button
            type="button"
            onClick={() => decide("REJECT")}
            disabled={busy || selected.size === 0}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reject {selected.size || ""}
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="min-w-[760px] text-left text-xs">
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 font-bold text-ink-soft">Transformer</th>
              <th className="px-3 py-2 font-bold text-ink-soft">Rating</th>
              <th className="px-3 py-2 font-bold text-ink-soft">Manufacturer</th>
              <th className="px-3 py-2 font-bold text-ink-soft">Store</th>
              <th className="px-3 py-2 font-bold text-ink-soft">Booked in by</th>
              <th className="px-3 py-2 font-bold text-ink-soft">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {units.map((u) => {
              const own = u.submittedById === viewerId;
              return (
                <tr key={u.id} className={own ? "bg-surface/60" : undefined}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={() => toggle(u.id)}
                      disabled={own || busy}
                      title={own ? "You booked this one in" : undefined}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/transformers/${u.id}`}
                      className="font-bold text-navy hover:text-kplc"
                    >
                      {u.gNumber ?? u.serialNumber}
                    </Link>
                    {own && (
                      <span className="ml-2 text-[11px] font-semibold text-amber-700">
                        yours — needs another checker
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft">{formatRating(u.ratingKva)}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{u.manufacturerName}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{u.storeName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{u.submittedByName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-ink-soft">
                    {u.submittedAt ? formatRelative(new Date(u.submittedAt)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-soft">
        Approving writes an <strong className="text-navy">Approved into stock</strong> event onto each
        unit&apos;s chain and an audit row naming you. Until then the lifecycle engine refuses to test
        or dispatch them.
      </p>

      <div className="flex justify-end">
        <Badge tone="warning">{units.length} awaiting a decision</Badge>
      </div>
    </div>
  );
}
