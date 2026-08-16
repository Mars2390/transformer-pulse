"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { APPROVAL_ACTION_META, type ApprovalAction } from "@/lib/approvals";
import { ROLE_LABELS } from "@/lib/format";

export type ApprovalState = {
  id: string;
  reference: string;
  status: "PENDING" | "APPROVED";
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
};

/**
 * The gate, as a person experiences it.
 *
 * Three states, and each has to say something different, because "you cannot
 * do this" without a next step is the most common way a control gets worked
 * around instead of followed:
 *
 *   NOTHING RAISED  — a form to ask, with the reason field the manager will
 *                     read. Not a bare button: an approval request with no
 *                     stated reason forces the approver to telephone somebody,
 *                     and after the third phone call they start approving
 *                     without asking.
 *   PENDING         — who it is with, since when, and the request PDF to print
 *                     and carry. This is the sheet that goes with the driver.
 *   APPROVED        — who signed it and when, the certificate, and the form
 *                     below unlocks.
 *
 * The panel is advisory. The API re-checks authorisation on every one of these
 * actions, so a stale page cannot be used to slip past the gate.
 */
export function RequestApprovalPanel({
  transformerId,
  action,
  current,
  contextLabel,
  children,
}: {
  transformerId: string;
  action: ApprovalAction;
  current: ApprovalState | null;
  /** Destination or purpose, recorded on the request so the approver sees it. */
  contextLabel?: string | null;
  /** The gated form. Rendered only once approval is in hand. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const meta = APPROVAL_ACTION_META[action];

  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approved = current?.status === "APPROVED";
  const pending = current?.status === "PENDING";

  async function raise() {
    setError(null);
    if (reason.trim().length < 5) {
      setError("Say why it is needed — the manager approving has to read something.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transformerIds: [transformerId],
          action,
          justification: reason.trim(),
          contextLabel: contextLabel || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? data?.skipped?.[0]?.reason ?? "Could not raise the request.");
        return;
      }
      toast(data.message, "success");
      router.refresh();
    } catch {
      setError("No connection. Nothing was raised.");
    } finally {
      setBusy(false);
    }
  }

  if (approved && current) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-extrabold text-white">
              APPROVED
            </span>
            <span className="font-mono text-xs font-bold text-emerald-900">
              {current.reference}
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-emerald-900">
            {meta.label} signed off by {current.decidedByName ?? "a manager"}
            {current.decidedAt
              ? ` on ${new Date(current.decidedAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
            .
          </p>
          <p className="mt-1 text-xs text-emerald-800">
            This authorises one {meta.label.toLowerCase()}. Doing it again needs a fresh approval.
          </p>
          <a
            href={`/api/pdf/approval/${current.id}`}
            className="mt-3 inline-block rounded-lg bg-navy px-4 py-2 text-xs font-bold text-white"
          >
            Download Approval PDF
          </a>
        </div>
        {children}
      </div>
    );
  }

  if (pending && current) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-extrabold text-white">
            PENDING APPROVAL
          </span>
          <span className="font-mono text-xs font-bold text-amber-900">{current.reference}</span>
        </div>
        <p className="mt-2 text-sm font-semibold text-amber-900">
          Waiting on {meta.approvers.map((r) => ROLE_LABELS[r]).join(" or ")}.
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Raised by {current.requestedByName} on{" "}
          {new Date(current.requestedAt).toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          . {meta.label} cannot go ahead until this is signed.
        </p>
        <a
          href={`/api/pdf/approval/${current.id}`}
          className="mt-3 inline-block rounded-lg border border-amber-400 bg-white px-4 py-2 text-xs font-bold text-amber-900"
        >
          Download Approval Request PDF
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-sm font-extrabold text-navy">{meta.label} needs approval first</p>
      <p className="mt-1 text-xs text-ink-soft">{meta.description}</p>
      {contextLabel && (
        <p className="mt-1 text-xs text-ink-soft">
          Recorded against: <span className="font-semibold text-navy">{contextLabel}</span>
        </p>
      )}

      <label htmlFor="approval-reason" className="mt-3 block text-xs font-bold text-navy">
        Why is it needed?
      </label>
      <textarea
        id="approval-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Replacing the failed unit at Kahawa West. 400 customers off since 09:20."
        className={`${inputClass} mt-1.5 text-sm`}
      />
      <p className="mt-1 text-[11px] text-ink-soft">
        This is printed on the request and is what the approver reads. A request with no reason
        makes somebody telephone you, and after the third call people start approving without
        asking.
      </p>

      {error && (
        <div className="mt-2">
          <FormError message={error} />
        </div>
      )}

      <button
        type="button"
        onClick={raise}
        disabled={busy}
        className="mt-3 rounded-xl bg-kplc px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
      >
        {busy ? "Raising…" : `Request ${meta.label} Approval`}
      </button>
    </div>
  );
}
