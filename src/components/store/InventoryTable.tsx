"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { inputClass } from "@/components/ui/Field";
import { TransformerPanel } from "./TransformerPanel";
import type { TransformerStatus } from "@/generated/prisma/enums";
import { formatDate, formatRating, STATUS_META, type Tone } from "@/lib/format";

export type InventoryRow = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  manufacturer: string;
  ratingKva: number;
  status: TransformerStatus;
  testState: "UNTESTED" | "PASSED" | "FAILED";
  warrantyLabel: string;
  warrantyState: "NOT_STARTED" | "UNDER_WARRANTY" | "EXPIRING_SOON" | "EXPIRED";
  location: string;
  receivedAt: string; // ISO — Dates do not survive the server/client boundary
};

type SortKey = "gNumber" | "serialNumber" | "manufacturer" | "ratingKva" | "status" | "receivedAt";

const WARRANTY_TONE: Record<InventoryRow["warrantyState"], Tone> = {
  NOT_STARTED: "neutral",
  UNDER_WARRANTY: "success",
  EXPIRING_SOON: "warning",
  EXPIRED: "danger",
};

const TEST_META: Record<InventoryRow["testState"], { label: string; tone: Tone }> = {
  UNTESTED: { label: "Untested", tone: "warning" },
  PASSED: { label: "Passed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export function InventoryTable({ rows }: { rows: InventoryRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const [rating, setRating] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("receivedAt");
  const [ascending, setAscending] = useState(false);
  const [panelId, setPanelId] = useState<string | null>(null);

  const ratings = useMemo(
    () => [...new Set(rows.map((r) => r.ratingKva))].sort((a, b) => a - b),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (status !== "ALL" && row.status !== status) return false;
      if (rating !== "ALL" && row.ratingKva !== Number(rating)) return false;
      if (!needle) return true;
      // Search everything a keeper might have in their hand: the G-Number on
      // the paperwork, the serial on the nameplate, the maker, the site.
      return [row.gNumber, row.serialNumber, row.manufacturer, row.location]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle));
    });

    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls last, whichever way we are sorting — a blank G-Number should
      // never win the top of the table.
      if (av == null) return 1;
      if (bv == null) return -1;
      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return ascending ? result : -result;
    });
  }, [rows, query, status, rating, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((v) => !v);
    } else {
      setSortKey(key);
      setAscending(true);
    }
  }

  const Th = ({ label, sort }: { label: string; sort?: SortKey }) => (
    <th className="px-4 py-3 text-left">
      {sort ? (
        <button
          type="button"
          onClick={() => toggleSort(sort)}
          className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wide text-ink-soft transition-colors hover:text-navy"
        >
          {label}
          <span className={sortKey === sort ? "text-kplc" : "text-ink-soft/30"}>
            {sortKey === sort ? (ascending ? "▲" : "▼") : "▾"}
          </span>
        </button>
      ) : (
        <span className="text-[11px] font-bold tracking-wide text-ink-soft">{label}</span>
      )}
    </th>
  );

  return (
    <div>
      {/* --- Controls ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search G-Number, serial, manufacturer or site…"
          className={`${inputClass} sm:max-w-xs`}
          aria-label="Search inventory"
        />

        <div className="flex gap-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${inputClass} sm:w-40`}
            aria-label="Filter by status"
          >
            <option value="ALL">All statuses</option>
            {Object.entries(STATUS_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>

          <select
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className={`${inputClass} sm:w-32`}
            aria-label="Filter by rating"
          >
            <option value="ALL">All ratings</option>
            {ratings.map((r) => <option key={r} value={r}>{r} kVA</option>)}
          </select>
        </div>

        <p className="text-xs text-ink-soft sm:ml-auto">
          {visible.length} of {rows.length}
        </p>
      </div>

      {/* --- Table ---------------------------------------------------------- */}
      {visible.length === 0 ? (
        <EmptyState
          message={
            rows.length === 0
              ? "Nothing in this store yet. Receive a transformer to begin."
              : "No transformers match those filters."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <Th label="G-NUMBER" sort="gNumber" />
                <Th label="SERIAL" sort="serialNumber" />
                <Th label="MANUFACTURER" sort="manufacturer" />
                <Th label="RATING" sort="ratingKva" />
                <Th label="STATUS" sort="status" />
                <Th label="TEST" />
                <Th label="WARRANTY" />
                <Th label="LOCATION" />
                <Th label="RECEIVED" sort="receivedAt" />
                <Th label="" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setPanelId(row.id)}
                  className="cursor-pointer transition-colors hover:bg-surface"
                >
                  <td className="px-4 py-3">
                    {row.gNumber ? (
                      <span className="font-mono font-bold text-navy">{row.gNumber}</span>
                    ) : (
                      <Badge tone="warning">Not assigned</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                    {row.serialNumber}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{row.manufacturer}</td>
                  <td className="px-4 py-3 font-semibold text-navy">
                    {formatRating(row.ratingKva)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_META[row.status].tone}>
                      {STATUS_META[row.status].label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={TEST_META[row.testState].tone}>
                      {TEST_META[row.testState].label}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={WARRANTY_TONE[row.warrantyState]}>
                      {row.warrantyLabel}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{row.location}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">
                    {formatDate(row.receivedAt)}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      {row.status === "IN_STORE" && (
                        <>
                          {row.testState !== "PASSED" && (
                            <Link
                              href={`/store/test/${row.id}`}
                              className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-navy transition-colors hover:border-kplc hover:text-kplc"
                            >
                              Test
                            </Link>
                          )}
                          {row.testState === "PASSED" && (
                            <Link
                              href={`/store/dispatch/${row.id}`}
                              className="rounded-lg bg-gold px-2.5 py-1.5 text-[11px] font-bold text-navy-dark transition-colors hover:bg-gold-dark"
                            >
                              Dispatch
                            </Link>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TransformerPanel transformerId={panelId} onClose={() => setPanelId(null)} />
    </div>
  );
}
