import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, EmptyState, Badge } from "@/components/ui";
import { formatRating, STATUS_META } from "@/lib/format";
import { visibleTransformerWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Untested transformers" };
export const dynamic = "force-dynamic";

/**
 * Every unit released on somebody else's test.
 *
 * This report exists because sampling is a defensible policy that becomes an
 * indefensible one the moment nobody can say how much of the fleet it covers.
 * The number on this page is the honest answer to "how many transformers in the
 * field have never been proved" — and it is a number KPLC currently cannot
 * produce at all.
 */
export default async function UntestedPage() {
  const user = await requireRole("MANAGER", "STORE_MANAGER", "ADMIN");
  const scope = visibleTransformerWhere(user);

  const units = await prisma.transformer.findMany({
    where: { ...scope, batchId: { not: null }, sampleTested: false },
    select: {
      id: true,
      gNumber: true,
      serialNumber: true,
      ratingKva: true,
      status: true,
      currentSiteName: true,
      region: true,
      manufacturer: { select: { name: true } },
      batch: { select: { batchRef: true, approvedAt: true } },
    },
    orderBy: [{ status: "asc" }, { gNumber: "asc" }],
    take: 1000,
  });

  const inField = units.filter((u) => u.status === "IN_FIELD");
  const faulty = units.filter((u) => u.status === "FAULTY");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">
          Untested transformers
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Units released on a sample of their consignment rather than being tested themselves. This
          is the number KPLC could not previously produce.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Never tested" value={String(units.length)} tone={units.length ? "warning" : "neutral"} />
        <StatTile label="Energised in the field" value={String(inField.length)} tone={inField.length ? "danger" : "neutral"} />
        <StatTile label="Faulty" value={String(faulty.length)} tone={faulty.length ? "danger" : "neutral"} />
        <StatTile label="Still in store" value={String(units.filter((u) => u.status === "IN_STORE").length)} />
      </div>

      <Card>
        <CardHeader title={`${units.length} units`} />
        {units.length === 0 ? (
          <EmptyState message="Nothing in scope was released untested." />
        ) : (
          <ul className="divide-y divide-line">
            {units.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span>⚠️</span>
                <Link href={`/transformers/${u.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-navy">
                    {u.gNumber ?? u.serialNumber}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">
                    {formatRating(u.ratingKva)} · {u.manufacturer.name} ·{" "}
                    {u.currentSiteName ?? u.region ?? "location not recorded"}
                    {u.batch?.batchRef ? ` · ${u.batch.batchRef}` : ""}
                  </span>
                </Link>
                <Badge tone={STATUS_META[u.status].tone}>{STATUS_META[u.status].label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
