import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import { formatDateTime, ROLE_LABELS, type Tone } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const ACTION_TONE: Record<string, Tone> = {
  CREATE: "success",
  EDIT: "info",
  ENABLE: "success",
  DISABLE: "warning",
  UNLOCK: "info",
  RESET_PIN: "warning",
  DELETE: "danger",
};

const ROLES = ["ALL", "ADMIN", "MANAGER", "STORE_KEEPER", "FIELD_ENGINEER"] as const;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; from?: string; to?: string }>;
}) {
  await requireRole("ADMIN");
  const params = await searchParams;

  const where: Prisma.AuditLogWhereInput = {};
  if (params.role && params.role !== "ALL") {
    where.actor = { role: params.role as "ADMIN" | "MANAGER" | "STORE_KEEPER" | "FIELD_ENGINEER" };
  }
  if (params.from || params.to) {
    where.createdAt = {};
    if (params.from) where.createdAt.gte = new Date(params.from);
    if (params.to) where.createdAt.lte = new Date(`${params.to}T23:59:59`);
  }

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { actor: { select: { name: true, role: true } } },
  });

  const inputClass =
    "min-h-11 rounded-lg border border-line bg-white px-3 py-2 text-xs text-navy outline-none focus:border-kplc";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy">Audit log</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Every administrative change to users, manufacturers and stores.
            Lifecycle events are never edited — they are not, and cannot be, in this log.
          </p>
        </div>
        <a
          href="/api/admin/audit/export"
          className="inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 text-xs font-bold text-navy transition-colors hover:border-navy/30"
        >
          Export CSV
        </a>
      </div>

      {/* --- Filters (plain GET form, no client JS needed) ------------------ */}
      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4" method="get">
        <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-soft">
          ROLE
          <select name="role" defaultValue={params.role ?? "ALL"} className={inputClass}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r === "ALL" ? "All roles" : ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-soft">
          FROM
          <input type="date" name="from" defaultValue={params.from} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-ink-soft">
          TO
          <input type="date" name="to" defaultValue={params.to} className={inputClass} />
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg bg-kplc px-4 text-xs font-bold text-white hover:bg-kplc-light">
          Apply
        </button>
        {(params.role || params.from || params.to) && (
          <a href="/admin/audit" className="rounded-lg border border-line px-4 py-2 text-xs font-bold text-navy">Clear</a>
        )}
      </form>

      <Card>
        <CardHeader title={`${entries.length} entries`} />
        {entries.length === 0 ? (
          <EmptyState message="No administrative actions match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-3">WHEN</th>
                  <th className="px-4 py-3">WHO</th>
                  <th className="px-4 py-3">ROLE</th>
                  <th className="px-4 py-3">ACTION</th>
                  <th className="px-4 py-3">TARGET</th>
                  <th className="px-4 py-3">DETAILS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-surface">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">{formatDateTime(e.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-navy">{e.actor.name}</td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{ROLE_LABELS[e.actor.role]}</td>
                    <td className="px-4 py-3"><Badge tone={ACTION_TONE[e.action] ?? "neutral"}>{e.action.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-3 text-navy"><span className="text-xs text-ink-soft">{e.targetType}</span> {e.targetLabel}</td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{e.details ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
