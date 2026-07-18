import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import { formatDateTime, type Tone } from "@/lib/format";

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

export default async function AuditPage() {
  await requireRole("ADMIN");

  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Audit log</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every administrative change to users, manufacturers and stores. Lifecycle
          events are never edited — they are not, and cannot be, in this log.
        </p>
      </div>

      <Card>
        <CardHeader title={`${entries.length} entries`} />
        {entries.length === 0 ? (
          <EmptyState message="No administrative actions recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-3">WHEN</th>
                  <th className="px-4 py-3">WHO</th>
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
                    <td className="px-4 py-3"><Badge tone={ACTION_TONE[e.action] ?? "neutral"}>{e.action.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-3 text-navy">
                      <span className="text-xs text-ink-soft">{e.targetType}</span> {e.targetLabel}
                    </td>
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
