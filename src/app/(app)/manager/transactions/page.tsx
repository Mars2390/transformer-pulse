import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, Badge, StatTile, EmptyState } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { inputClass } from "@/components/ui/input-class";
import {
  MOVEMENTS,
  MOVEMENT_KEYS,
  TRANSACTION_STATUSES,
  TRANSACTION_STATUS_META,
  type MovementKey,
  type TransactionStatus,
} from "@/lib/transactions";

export const metadata: Metadata = { title: "Movements" };
export const dynamic = "force-dynamic";

/**
 * Every movement, filterable. Server-rendered from the query string rather than
 * client state, so a manager can paste a link to "everything in transit" and
 * the recipient sees the same list.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; movement?: string; q?: string }>;
}) {
  await requireRole("MANAGER", "STORE_MANAGER", "ADMIN");
  const sp = await searchParams;

  const status = TRANSACTION_STATUSES.includes(sp.status as TransactionStatus)
    ? (sp.status as TransactionStatus)
    : undefined;
  const movement = MOVEMENT_KEYS.includes(sp.movement as MovementKey)
    ? (sp.movement as MovementKey)
    : undefined;
  const q = sp.q?.trim() ?? "";

  const [records, counts] = await Promise.all([
    prisma.transactionRecord.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(movement ? { movement } : {}),
        ...(q
          ? {
              OR: [
                { batchRef: { contains: q, mode: "insensitive" } },
                { toName: { contains: q, mode: "insensitive" } },
                { fromName: { contains: q, mode: "insensitive" } },
                { vehiclePlate: { contains: q, mode: "insensitive" } },
                { transformer: { gNumber: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { initiatedAt: "desc" },
      take: 200,
      include: {
        transformer: { select: { id: true, gNumber: true, serialNumber: true } },
        initiatedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    }),
    prisma.transactionRecord.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const countOf = (s: TransactionStatus) =>
    counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Movements</h1>
          <p className="mt-1.5 text-sm text-ink-soft">
            Every transformer journey, from the request to the signature on arrival.
          </p>
        </div>
        <Link
          href="/manager/transactions/approvals"
          className="inline-flex min-h-11 items-center rounded-xl bg-kplc px-4 text-xs font-bold text-white"
        >
          Approvals ({countOf("PENDING_APPROVAL")})
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TRANSACTION_STATUSES.map((s) => (
          <StatTile
            key={s}
            label={TRANSACTION_STATUS_META[s].label}
            value={String(countOf(s))}
            tone={TRANSACTION_STATUS_META[s].tone}
            href={`/manager/transactions?status=${s}`}
          />
        ))}
      </div>

      <form className="grid grid-cols-1 gap-2 sm:grid-cols-4" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="🔍 Batch, G-Number, plate, place…"
          className={`${inputClass} py-2 text-xs sm:col-span-2`}
        />
        <select name="status" defaultValue={status ?? ""} className={`${inputClass} py-2 text-xs`}>
          <option value="">All statuses</option>
          {TRANSACTION_STATUSES.map((s) => (
            <option key={s} value={s}>{TRANSACTION_STATUS_META[s].label}</option>
          ))}
        </select>
        <select name="movement" defaultValue={movement ?? ""} className={`${inputClass} py-2 text-xs`}>
          <option value="">All movements</option>
          {MOVEMENT_KEYS.map((k) => (
            <option key={k} value={k}>{MOVEMENTS[k].label}</option>
          ))}
        </select>
      </form>

      <Card>
        <CardHeader title={`${records.length} shown`} />
        {records.length === 0 ? (
          <EmptyState message="No movements match. Clear the filters to see everything." />
        ) : (
          <ul className="divide-y divide-line">
            {records.map((r) => {
              const m = MOVEMENTS[r.movement as MovementKey];
              const meta = TRANSACTION_STATUS_META[r.status as TransactionStatus] ?? {
                label: r.status,
                tone: "neutral" as const,
              };
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/transformers/${r.transformer.id}`}
                      className="text-sm font-semibold text-navy hover:text-kplc"
                    >
                      {r.transformer.gNumber ?? r.transformer.serialNumber}
                    </Link>
                    <p className="truncate text-xs text-ink-soft">
                      {m?.label ?? r.movement} · {r.fromName} → {r.toName}
                      {r.vehiclePlate ? ` · ${r.vehiclePlate}` : ""}
                      {r.driverName ? ` · ${r.driverName}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-ink-soft">
                      {r.batchRef ? `${r.batchRef} · ` : ""}raised by {r.initiatedBy.name}
                      {r.approvedBy ? ` · approved by ${r.approvedBy.name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-soft">{formatRelative(r.initiatedAt)}</span>
                  <Link href={`/transactions/${r.id}`} className="shrink-0 inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline">
                    Track
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
