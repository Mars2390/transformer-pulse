"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import type { StoryClaim } from "./story-types";
import { formatDate, formatKes } from "@/lib/format";

export type WarrantyView = {
  state: "NOT_STARTED" | "UNDER_WARRANTY" | "EXPIRING_SOON" | "EXPIRED";
  startISO: string | null;
  expiryISO: string | null;
  months: number;
  monthsUsed: number;
  daysRemaining: number | null;
  claimable: boolean;
};

export function WarrantyTab({
  warranty,
  claims,
}: {
  warranty: WarrantyView;
  claims: StoryClaim[];
}) {
  const pct =
    warranty.months > 0
      ? Math.min(100, Math.max(0, (warranty.monthsUsed / warranty.months) * 100))
      : 0;

  const barColour =
    warranty.state === "EXPIRED"
      ? "bg-red-500"
      : warranty.state === "EXPIRING_SOON"
        ? "bg-amber-500"
        : warranty.state === "UNDER_WARRANTY"
          ? "bg-emerald-500"
          : "bg-graphite-300";

  const daysTone =
    warranty.daysRemaining == null
      ? "neutral"
      : warranty.daysRemaining <= 0
        ? "danger"
        : warranty.daysRemaining < 30
          ? "danger"
          : warranty.daysRemaining < 90
            ? "warning"
            : "success";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-sm font-bold text-navy">Warranty period</h3>
          <Badge tone={daysTone}>
            {warranty.state === "NOT_STARTED"
              ? "Not started"
              : warranty.state === "EXPIRED"
                ? "Expired"
                : `${warranty.daysRemaining} days left`}
          </Badge>
        </div>

        {/* Progress bar: months used against total. */}
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={`h-full rounded-full ${barColour}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-soft">
          <span>{warranty.monthsUsed} of {warranty.months} months used</span>
          <span>{Math.round(pct)}%</span>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-[11px] font-bold tracking-wide text-ink-soft">STARTS</dt>
            <dd className="mt-1 text-sm font-semibold text-navy">{formatDate(warranty.startISO)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold tracking-wide text-ink-soft">EXPIRES</dt>
            <dd className="mt-1 text-sm font-semibold text-navy">{formatDate(warranty.expiryISO)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold tracking-wide text-ink-soft">LENGTH</dt>
            <dd className="mt-1 text-sm font-semibold text-navy">{warranty.months} months</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold tracking-wide text-ink-soft">CLAIMABLE</dt>
            <dd className="mt-1">
              <Badge tone={warranty.claimable ? "success" : "neutral"}>
                {warranty.claimable ? "Yes" : "No"}
              </Badge>
            </dd>
          </div>
        </dl>

        {warranty.state === "NOT_STARTED" && (
          <p className="mt-4 rounded-lg bg-surface px-3 py-2 text-xs text-ink-soft">
            The warranty clock starts when the store receives the unit — it has
            not been received yet.
          </p>
        )}
      </div>

      {/* --- Claims ------------------------------------------------------ */}
      {claims.length > 0 && (
        <div className="rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-sm font-bold text-navy">
              Warranty claims ({claims.length})
            </h3>
          </div>
          <ul className="divide-y divide-line">
            {claims.map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        claim.status === "APPROVED" || claim.status === "CLOSED"
                          ? "success"
                          : claim.status === "REJECTED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {claim.status}
                    </Badge>
                    {claim.referenceNo && (
                      <span className="font-mono text-xs text-ink-soft">{claim.referenceNo}</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[13px] text-navy">{claim.faultReason}</p>
                  <p className="text-xs text-ink-soft">Against {claim.manufacturerName}</p>
                </div>
                {claim.claimValueKes != null && (
                  <p className="shrink-0 text-sm font-bold text-navy">
                    {formatKes(claim.claimValueKes)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Link
            href="/manager/warranty"
            className="block border-t border-line px-5 py-3 inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline"
          >
            Manage claims →
          </Link>
        </div>
      )}
    </div>
  );
}
