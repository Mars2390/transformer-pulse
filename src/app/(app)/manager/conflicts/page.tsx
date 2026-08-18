import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, EmptyState, Badge } from "@/components/ui";
import { formatRating } from "@/lib/format";
import { visibleTransformerWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Record conflicts" };
export const dynamic = "force-dynamic";

/** How a conflicted field is described to a human. */
const FIELD_LABELS: Record<string, string> = {
  make: "Manufacturer",
  ratingKva: "Rating (kVA)",
  yearOfManufacture: "Year of manufacture",
  serialNumber: "Serial number",
  gNumber: "G-Number",
};

/**
 * Where two sources disagree about the same transformer.
 *
 * The inspection importer never writes an identity field back onto a
 * Transformer — it raises one of these instead. That is the whole design: the
 * register has 66% serial coverage and plate numbers reading "Defaced", and
 * letting the most recent upload win is precisely the failure this replaces.
 *
 * The consequence is that disagreements accumulate somewhere, and until now
 * that somewhere had no screen. The dashboard counted them and linked here, to
 * a page that did not exist.
 *
 * This page reads and does not write. Resolving a conflict means correcting the
 * asset record, which already has an audited route with a mandatory reason
 * (/transformers/[id] → correct). Bolting a second, unaudited write path onto
 * this list would undo the reason the conflicts exist in the first place.
 */
export default async function ConflictsPage() {
  const user = await requireRole("MANAGER", "ADMIN");
  const scope = visibleTransformerWhere(user);

  const conflicts = await prisma.recordConflict.findMany({
    where: { status: "OPEN", transformer: scope },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    include: {
      transformer: {
        select: {
          id: true,
          gNumber: true,
          serialNumber: true,
          ratingKva: true,
          currentSiteName: true,
          substationCode: true,
          region: true,
        },
      },
    },
  });

  // Group by transformer: a unit whose make AND rating AND year all disagree is
  // one argument to settle, not three unrelated ones, and reading it as three
  // rows hides that the record as a whole is untrustworthy.
  const byTransformer = new Map<string, typeof conflicts>();
  for (const c of conflicts) {
    const list = byTransformer.get(c.transformerId) ?? [];
    list.push(c);
    byTransformer.set(c.transformerId, list);
  }

  const fieldCounts = new Map<string, number>();
  for (const c of conflicts) fieldCounts.set(c.field, (fieldCounts.get(c.field) ?? 0) + 1);

  const dmy = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "date not recorded");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Record conflicts</h1>
        <p className="mt-1.5 max-w-3xl text-sm text-ink-soft">
          Two sources describing the same transformer differently. The importer never overwrites an
          identity field on the strength of one inspection form — it records the disagreement here so
          somebody decides, rather than letting the most recent upload quietly win.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Open conflicts"
          value={String(conflicts.length)}
          tone={conflicts.length ? "warning" : "neutral"}
        />
        <StatTile
          label="Transformers affected"
          value={String(byTransformer.size)}
          tone={byTransformer.size ? "warning" : "neutral"}
        />
        <StatTile label="On manufacturer" value={String(fieldCounts.get("make") ?? 0)} />
        <StatTile label="On rating" value={String(fieldCounts.get("ratingKva") ?? 0)} />
      </div>

      <Card>
        <CardHeader
          title={
            byTransformer.size === 0
              ? "Nothing to settle"
              : `${byTransformer.size} transformer${byTransformer.size === 1 ? "" : "s"} with disagreeing records`
          }
        />
        {conflicts.length === 0 ? (
          <EmptyState message="No open conflicts in your scope. Every imported record agreed with what is already on the register." />
        ) : (
          <ul className="divide-y divide-line">
            {[...byTransformer.entries()].map(([id, list]) => {
              const t = list[0].transformer;
              return (
                <li key={id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/transformers/${id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-navy">
                        {t.gNumber ?? t.serialNumber}
                      </span>
                      <span className="block truncate text-xs text-ink-soft">
                        {formatRating(t.ratingKva)} ·{" "}
                        {t.currentSiteName ?? t.substationCode ?? t.region ?? "location not recorded"}
                      </span>
                    </Link>
                    <Badge tone="warning">
                      {list.length} disagreement{list.length === 1 ? "" : "s"}
                    </Badge>
                  </div>

                  <div className="mt-3 space-y-2">
                    {list.map((c) => (
                      <div key={c.id} className="rounded-xl border border-line bg-surface-2 p-3">
                        <p className="text-[11px] font-extrabold tracking-[0.08em] text-ink-soft">
                          {(FIELD_LABELS[c.field] ?? c.field).toUpperCase()}
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-line bg-white px-3 py-2">
                            <p className="text-sm font-bold text-navy">{c.valueA}</p>
                            <p className="mt-0.5 text-[11px] text-ink-soft">
                              {c.sourceA} · {dmy(c.dateA)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-line bg-white px-3 py-2">
                            <p className="text-sm font-bold text-navy">{c.valueB}</p>
                            <p className="mt-0.5 text-[11px] text-ink-soft">
                              {c.sourceB} · {dmy(c.dateB)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Link
                    href={`/transformers/${id}`}
                    className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-xs font-bold text-navy hover:border-kplc"
                  >
                    Open the record to settle it
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-ink-soft">
        Settling a conflict means correcting the transformer record itself, which is an audited change
        that asks for a reason. That is deliberately not done from this list: a one-click winner here
        would be an unattributed overwrite, which is the thing this whole mechanism exists to prevent.
      </p>
    </div>
  );
}
