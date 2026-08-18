import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, EmptyState, Badge } from "@/components/ui";
import { inputClass } from "@/components/ui/input-class";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Field engineers" };
export const dynamic = "force-dynamic";

const OVERDUE_MS = 48 * 60 * 60 * 1000;

/**
 * Who is in the field, what they are holding, and what they have finished.
 *
 * "Active tasks" is deliberately units ASSIGNED AND NOT YET CONFIRMED, not
 * everything they have ever touched. It is the number a store keeper needs
 * before adding a fifth delivery to somebody's day, and the number a manager
 * needs when a unit has been on a lorry for three days.
 */
export default async function FieldEngineersPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  await requireRole("ADMIN", "MANAGER");
  const sp = await searchParams;
  const regionFilter = sp.region?.trim() ?? "";

  const engineers = await prisma.user.findMany({
    where: {
      role: "FIELD_ENGINEER",
      ...(regionFilter ? { region: { contains: regionFilter, mode: "insensitive" } } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      region: true,
      active: true,
      assignedTransformers: {
        select: { id: true, gNumber: true, serialNumber: true, assignedAt: true, currentSiteName: true },
        orderBy: { assignedAt: "asc" },
      },
      _count: { select: { events: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const allRegions = [
    ...new Set(
      (await prisma.user.findMany({ where: { role: "FIELD_ENGINEER" }, select: { region: true } }))
        .map((u) => u.region)
        .filter((r): r is string => !!r),
    ),
  ].sort();

  const now = Date.now();
  const totalAssigned = engineers.reduce((n, e) => n + e.assignedTransformers.length, 0);
  const totalOverdue = engineers.reduce(
    (n, e) =>
      n + e.assignedTransformers.filter((t) => t.assignedAt && now - t.assignedAt.getTime() > OVERDUE_MS).length,
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Field engineers</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Every dispatch now carries an engineer&apos;s name. This is who is holding what.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Engineers" value={String(engineers.length)} />
        <StatTile label="Active" value={String(engineers.filter((e) => e.active).length)} />
        <StatTile label="Units awaiting confirmation" value={String(totalAssigned)} />
        <StatTile
          label="Over 48 hours"
          value={String(totalOverdue)}
          tone={totalOverdue ? "danger" : "neutral"}
        />
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <select name="region" defaultValue={regionFilter} className={`${inputClass} w-56 py-2 text-xs`}>
          <option value="">All regions</option>
          {allRegions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-xl bg-kplc px-4 text-xs font-bold text-white">
          Filter
        </button>
      </form>

      {engineers.length === 0 ? (
        <EmptyState message="No field engineer matches that filter." />
      ) : (
        <div className="space-y-4">
          {engineers.map((e) => {
            const overdue = e.assignedTransformers.filter(
              (t) => t.assignedAt && now - t.assignedAt.getTime() > OVERDUE_MS,
            );
            return (
              <Card key={e.id}>
                <CardHeader
                  title={`${e.name}${e.active ? "" : " — account disabled"}`}
                  action={
                    <span className="flex items-center gap-2">
                      {overdue.length > 0 && <Badge tone="danger">{overdue.length} over 48h</Badge>}
                      <Badge tone={e.assignedTransformers.length ? "warning" : "neutral"}>
                        {e.assignedTransformers.length} active
                      </Badge>
                    </span>
                  }
                />
                <div className="px-5 py-3">
                  <p className="text-xs text-ink-soft">
                    {e.email} · {e.region ?? "no region recorded"} · {e._count.events} chain
                    entries recorded
                  </p>

                  {e.assignedTransformers.length === 0 ? (
                    <p className="mt-2 text-xs text-ink-soft">Nothing awaiting confirmation.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                      {e.assignedTransformers.map((t) => {
                        const late = t.assignedAt && now - t.assignedAt.getTime() > OVERDUE_MS;
                        return (
                          <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                            <span>{late ? "⚠️" : "🚚"}</span>
                            <Link
                              href={`/transformers/${t.id}`}
                              className="min-w-0 flex-1 truncate text-sm font-semibold text-navy hover:text-kplc"
                            >
                              {t.gNumber ?? t.serialNumber}
                              <span className="ml-2 text-xs font-normal text-ink-soft">
                                {t.currentSiteName ?? "destination not recorded"}
                              </span>
                            </Link>
                            <span
                              className={`shrink-0 text-[11px] font-semibold ${late ? "text-red-700" : "text-ink-soft"}`}
                            >
                              {t.assignedAt ? formatRelative(t.assignedAt) : "—"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
