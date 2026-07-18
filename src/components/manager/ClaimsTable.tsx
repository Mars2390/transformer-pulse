"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { formatDate, formatKes, type Tone } from "@/lib/format";

export type ClaimRow = {
  id: string;
  gNumber: string;
  transformerId: string;
  manufacturer: string;
  faultReason: string;
  faultDateISO: string | null;
  warrantyExpiryISO: string | null;
  claimValueKes: number | null;
  status: "OPEN" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CLOSED";
  daysSinceRaised: number;
  referenceNo: string | null;
};

const STATUS_TONE: Record<ClaimRow["status"], Tone> = {
  OPEN: "warning",
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
  CLOSED: "neutral",
};

/** The next legal step for a claim, and what it needs. */
const NEXT: Record<ClaimRow["status"], { to: ClaimRow["status"]; label: string; needsRef?: boolean }[]> = {
  OPEN: [{ to: "SUBMITTED", label: "Mark submitted", needsRef: true }],
  SUBMITTED: [
    { to: "APPROVED", label: "Approved" },
    { to: "REJECTED", label: "Rejected" },
  ],
  APPROVED: [{ to: "CLOSED", label: "Mark settled" }],
  REJECTED: [],
  CLOSED: [],
};

export function ClaimsTable({ rows }: { rows: ClaimRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function update(id: string, to: ClaimRow["status"], needsRef?: boolean) {
    let referenceNo = "";
    if (needsRef) {
      referenceNo = window.prompt("Manufacturer's RMA / claim reference:")?.trim() ?? "";
      if (!referenceNo) return;
    }
    setBusy(id);
    const res = await fetch(`/api/warranty/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to, referenceNo }),
    });
    setBusy(null);
    if (res.ok) router.refresh();
    else window.alert((await res.json()).error ?? "Could not update the claim.");
  }

  if (rows.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-ink-soft">No warranty claims.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
          <tr>
            <th className="px-4 py-3">G-NUMBER</th>
            <th className="px-4 py-3">MANUFACTURER</th>
            <th className="px-4 py-3">FAULT</th>
            <th className="px-4 py-3">FAULT DATE</th>
            <th className="px-4 py-3">VALUE</th>
            <th className="px-4 py-3">STATUS</th>
            <th className="px-4 py-3">AGE</th>
            <th className="px-4 py-3">ACTIONS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id} className="align-top hover:bg-surface">
              <td className="px-4 py-3">
                <Link href={`/transformers/${row.transformerId}`} className="font-mono font-bold text-navy hover:text-kplc">
                  {row.gNumber}
                </Link>
                {row.referenceNo && <p className="font-mono text-[11px] text-ink-soft">{row.referenceNo}</p>}
              </td>
              <td className="px-4 py-3 text-ink-soft">{row.manufacturer}</td>
              <td className="max-w-56 px-4 py-3 text-[13px] text-navy">{row.faultReason}</td>
              <td className="px-4 py-3 text-ink-soft">{formatDate(row.faultDateISO)}</td>
              <td className="px-4 py-3 font-bold text-navy">{formatKes(row.claimValueKes)}</td>
              <td className="px-4 py-3">
                <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
              </td>
              <td className="px-4 py-3 text-ink-soft">{row.daysSinceRaised}d</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {NEXT[row.status].map((step) => (
                    <button
                      key={step.to}
                      type="button"
                      disabled={busy === row.id}
                      onClick={() => update(row.id, step.to, step.needsRef)}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                        step.to === "REJECTED"
                          ? "border border-red-200 text-red-700 hover:bg-red-50"
                          : "bg-kplc text-white hover:bg-kplc-light"
                      }`}
                    >
                      {step.label}
                    </button>
                  ))}
                  {NEXT[row.status].length === 0 && <span className="text-[11px] text-ink-soft">—</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
