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

/**
 * The consignment queue, now with multi-select.
 *
 * This was the last approval screen in the system without checkboxes — every
 * other one had them, and here a manager facing eleven consignments on a Monday
 * pressed eleven buttons and sat through eleven page refreshes.
 *
 * The per-card buttons are KEPT. Releasing a consignment that contains untested
 * units is a decision somebody should make while looking at that consignment's
 * own warning, not while looking at a row of ticks. So the bar at the top is
 * for the routine ones and the card buttons are still there for the ones that
 * deserve a second look — and a card carrying untested units cannot be selected
 * from the bar at all. It has to be released deliberately, from its own card,
 * with the red warning in view.
 */
export function BatchApprovals({ batches }: { batches: PendingBatch[] }) {
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastApprovals, setLastApprovals] = useState<string[]>([]);

  // Bulk-selectable = approvable AND fully tested AND the delivery note agrees.
  // The two exclusions are the whole point: an untested release and a count
  // mismatch are exactly the decisions that must not be made by ticking a box.
  const selectable = batches.filter(
    (b) => b.canApprove && b.untested === 0 && b.declared === b.entered,
  );
  const needsAttention = batches.filter(
    (b) => b.canApprove && (b.untested > 0 || b.declared !== b.entered),
  );
  const allSelected = selectable.length > 0 && selectable.every((b) => selected.has(b.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function post(batchIds: string[], decision: "APPROVE" | "REJECT", busyKey: string) {
    setError(null);
    if (decision === "REJECT" && reason.trim().length < 3) {
      setError("Say why the consignment is being refused.");
      return;
    }
    setBusy(busyKey);
    try {
      const res = await fetch("/api/batches/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchIds, decision, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? data?.skipped?.[0]?.reason ?? "Could not record the decision.");
        return;
      }
      toast(data.message, data.untestedReleased || data.skipped?.length ? "error" : "success");
      // Held so the schedule PDF covers exactly what was just decided rather
      // than everything approved today — two managers working the same queue
      // would otherwise each print a sheet claiming the other's work.
      setLastApprovals(data.approvalIds ?? []);
      setSelected(new Set());
      setReason("");
      router.refresh();
    } catch {
      setError("No connection. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const decide = (batchId: string, decision: "APPROVE" | "REJECT") =>
    post([batchId], decision, batchId);

  if (batches.length === 0) {
    return <EmptyState message="No consignment is waiting for a decision." />;
  }

  return (
    <div className="space-y-4">
      {lastApprovals.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold text-emerald-900">
            {lastApprovals.length} certificates issued. Each travels with its own unit; this sheet
            covers the lot.
          </p>
          <a
            href={`/api/pdf/approval-batch?ids=${lastApprovals.join(",")}`}
            className="ml-auto rounded-lg bg-navy px-3.5 py-2 text-xs font-bold text-white"
          >
            Download schedule PDF
          </a>
        </div>
      )}

      {/* The bulk bar. Only ever offers the clean consignments. */}
      {(selectable.length > 0 || needsAttention.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
          <label className="flex items-center gap-2 text-xs font-bold text-navy">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(selectable.map((b) => b.id)))
              }
              disabled={Boolean(busy) || selectable.length === 0}
              className="h-4 w-4"
            />
            Select all clean consignments ({selectable.length})
          </label>
          <span className="text-xs text-ink-soft">{selected.size} selected</span>
          {needsAttention.length > 0 && (
            <span className="text-[11px] font-semibold text-amber-700">
              {needsAttention.length} held back — untested units or a count mismatch. Release those
              from their own card.
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required to refuse)"
              className={`${inputClass} w-56 py-2 text-xs`}
            />
            <button
              type="button"
              onClick={() => post([...selected], "APPROVE", "bulk")}
              disabled={Boolean(busy) || selected.size === 0}
              className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-ink-soft/40"
            >
              {busy === "bulk" ? "Working…" : `Approve Selected (${selected.size})`}
            </button>
            <button
              type="button"
              onClick={() => post([...selected], "REJECT", "bulk")}
              disabled={Boolean(busy) || selected.size === 0}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Refuse ({selected.size})
            </button>
          </div>
        </div>
      )}

      {error && <FormError message={error} />}
      {batches.map((b) => (
        <div key={b.id} className="rounded-2xl border border-line bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <input
              type="checkbox"
              checked={selected.has(b.id)}
              onChange={() => toggle(b.id)}
              disabled={Boolean(busy) || !selectable.some((s) => s.id === b.id)}
              title={
                b.blockedReason ??
                (b.untested > 0
                  ? "Contains untested units — release this one from its own card, with the warning in view."
                  : b.declared !== b.entered
                    ? "The delivery note and the entered count disagree. Resolve that first."
                    : undefined)
              }
              className="h-4 w-4"
            />
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
              className="mt-2 inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline"
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
