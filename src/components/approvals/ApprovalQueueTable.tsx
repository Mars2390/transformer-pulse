"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { PinConfirm } from "@/components/ui/PinConfirm";
import { formatRelative } from "@/lib/format";
import { APPROVAL_ACTION_META, type ApprovalAction } from "@/lib/approvals";

export type PendingApproval = {
  id: string;
  reference: string;
  action: ApprovalAction;
  transformerId: string;
  label: string;
  rating: string;
  storeName: string | null;
  contextLabel: string | null;
  justification: string | null;
  requestedByName: string;
  requestedAt: string; // ISO
  emergency: boolean;
  canSign: boolean;
  blockedReason: string | null;
};

/**
 * Every action approval in one queue, with bulk sign-off.
 *
 * ONE QUEUE, NOT SIX. Before this screen a manager had stock approvals on one
 * page, consignments on another, movements on a third, and dispatch and
 * install nowhere at all. Nobody can tell you what they are holding up when
 * the answer is spread over three screens and two that do not exist.
 *
 * A row the viewer raised themselves is shown with its checkbox disabled and
 * the reason on the row, rather than hidden. A queue whose count does not match
 * its contents is a queue people stop trusting — and the same rule is
 * re-checked per record on the server, because this is advice and that is the
 * control.
 *
 * Emergency ratifications sort to the top and are tinted. Those are the ones
 * where the work has ALREADY happened and a manager is being asked to agree
 * with it after the fact; burying them among ordinary requests is how they get
 * rubber-stamped.
 */
export function ApprovalQueueTable({ approvals }: { approvals: PendingApproval[] }) {
  const router = useRouter();
  const toast = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<"ALL" | ApprovalAction>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDecided, setLastDecided] = useState<string[]>([]);
  // The decision waiting for a signature. Held rather than acted on, because the
  // PIN is now part of the request and there is nowhere else to ask for it.
  const [pending, setPending] = useState<"APPROVE" | "REJECT" | null>(null);
  // Kept apart from `error`: a refused PIN belongs in the dialog it was typed
  // into, not on the page behind it that the person is no longer reading.
  const [pinError, setPinError] = useState<string | null>(null);

  const shown = useMemo(
    () => (filter === "ALL" ? approvals : approvals.filter((a) => a.action === filter)),
    [approvals, filter],
  );
  const selectable = shown.filter((a) => a.canSign);
  const allSelected = selectable.length > 0 && selectable.every((a) => selected.has(a.id));

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of approvals) m.set(a.action, (m.get(a.action) ?? 0) + 1);
    return m;
  }, [approvals]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Chooses the decision, then asks for the signature.
   *
   * The selection and the remarks are checked BEFORE the PIN is requested. The
   * other order means somebody types six digits and is then told they forgot to
   * say why they were refusing, which is the kind of small insult that gets a
   * control worked around rather than used.
   */
  function decide(decision: "APPROVE" | "REJECT") {
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one request.");
      return;
    }
    if (decision === "REJECT" && notes.trim().length < 3) {
      setError("Say why they are being refused. A refusal with no reason cannot be acted on.");
      return;
    }
    setPinError(null);
    setPending(decision);
  }

  async function sign(pin: string) {
    const decision = pending;
    if (!decision) return;

    setPinError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/approvals/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvalIds: [...selected],
          decision,
          notes: notes.trim() || undefined,
          // Spent again server-side by requirePinConfirmation() before the loop
          // starts, so a wrong PIN refuses the whole batch rather than half of it.
          pin,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // A wrong PIN is a 403, a malformed one a 422, and the APPROVAL_PIN
        // throttle a 429. All three mean "the signature did not happen, try
        // again here", so they stay in the dialog with the box still open.
        if (res.status === 403 || res.status === 422 || res.status === 429) {
          setPinError(data?.error ?? "That PIN was not accepted.");
          return;
        }
        setPending(null);
        setError(data?.error ?? "Could not record the decision.");
        return;
      }
      setPending(null);
      toast(data.message, data.skipped?.length ? "error" : "success");
      // Held so the schedule PDF covers exactly what was just decided, rather
      // than "everything approved today" — two managers working the same queue
      // would otherwise each print a sheet claiming the other's work.
      setLastDecided((data.decided ?? []).map((d: { id: string }) => d.id));
      setSelected(new Set());
      setNotes("");
      router.refresh();
    } catch {
      setPinError("No connection. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  if (approvals.length === 0) {
    return <EmptyState message="Nothing is waiting for your signature." />;
  }

  return (
    <div className="space-y-4">
      {lastDecided.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-semibold text-emerald-900">
            {lastDecided.length} decided. Each has its own certificate; this sheet covers the lot.
          </p>
          <a
            href={`/api/pdf/approval-batch?ids=${lastDecided.join(",")}`}
            className="ml-auto rounded-lg bg-navy px-3.5 py-2 text-xs font-bold text-white"
          >
            Download schedule PDF
          </a>
        </div>
      )}

      {/* Action filter. Derived from the catalog, never hand-listed. */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter("ALL")}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
            filter === "ALL" ? "bg-navy text-white" : "border border-line bg-white text-ink-soft"
          }`}
        >
          All ({approvals.length})
        </button>
        {[...counts.entries()].map(([action, n]) => (
          <button
            key={action}
            type="button"
            onClick={() => setFilter(action as ApprovalAction)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
              filter === action ? "bg-navy text-white" : "border border-line bg-white text-ink-soft"
            }`}
          >
            {APPROVAL_ACTION_META[action as ApprovalAction].label} ({n})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <label className="flex items-center gap-2 text-xs font-bold text-navy">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set(selectable.map((a) => a.id)))
            }
            disabled={busy || selectable.length === 0}
            className="h-4 w-4"
          />
          Select all you can sign ({selectable.length})
        </label>
        <span className="text-xs text-ink-soft">{selected.size} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Remarks (required to refuse)"
            className={`${inputClass} w-56 py-2 text-xs`}
          />
          <button
            type="button"
            onClick={() => decide("APPROVE")}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-ink-soft/40"
          >
            {busy ? "Working…" : `Approve Selected (${selected.size})`}
          </button>
          <button
            type="button"
            onClick={() => decide("REJECT")}
            disabled={busy || selected.size === 0}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refuse ({selected.size})
          </button>
        </div>
      </div>

      {error && <FormError message={error} />}

      <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
        {shown.map((a) => (
          <li
            key={a.id}
            className={`flex items-start gap-3 px-4 py-3 ${
              a.emergency ? "bg-amber-50/70" : a.canSign ? "" : "bg-surface/60"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              disabled={!a.canSign || busy}
              title={a.blockedReason ?? undefined}
              className="mt-1 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/transformers/${a.transformerId}`}
                  className="text-sm font-bold text-navy hover:text-kplc"
                >
                  {a.label}
                </Link>
                <Badge tone={a.emergency ? "danger" : "warning"}>
                  {APPROVAL_ACTION_META[a.action].label}
                </Badge>
                <span className="font-mono text-[11px] font-semibold text-ink-soft">
                  {a.reference}
                </span>
                {a.emergency && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                    ALREADY DONE — RATIFY
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ink-soft">
                {a.rating}
                {a.storeName ? ` · ${a.storeName}` : ""}
                {a.contextLabel ? ` · ${a.contextLabel}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                Raised by {a.requestedByName} · {formatRelative(new Date(a.requestedAt))}
              </p>
              {a.justification && <p className="mt-1 text-xs text-ink">{a.justification}</p>}
              {a.emergency && (
                <p className="mt-1 text-[11px] font-semibold text-amber-800">
                  This work was carried out before approval to restore supply. Signing here confirms
                  it after the fact; refusing raises it as an exception, it does not undo it.
                </p>
              )}
              {a.blockedReason && (
                <p className="mt-1 text-[11px] font-semibold text-amber-700">{a.blockedReason}</p>
              )}
            </div>
            <a
              href={`/api/pdf/approval/${a.id}`}
              className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-bold text-kplc hover:underline"
            >
              Request PDF
            </a>
          </li>
        ))}
      </ul>

      <PinConfirm
        open={pending !== null}
        title={pending === "REJECT" ? "Sign the refusal" : "Sign the approval"}
        summary={
          pending === "REJECT"
            ? `Refusing ${selected.size} request${selected.size === 1 ? "" : "s"}. Your PIN records you as the person who refused them.`
            : `Approving ${selected.size} request${selected.size === 1 ? "" : "s"}. Your PIN is the signature on each certificate.`
        }
        confirmLabel={pending === "REJECT" ? "Refuse" : "Approve"}
        busy={busy}
        error={pinError}
        onCancel={() => setPending(null)}
        onConfirm={sign}
      />
    </div>
  );
}
