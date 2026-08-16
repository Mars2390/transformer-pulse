import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, Badge, StatTile, EmptyState } from "@/components/ui";
import { TransformerMap } from "@/components/map/TransformerMap";
import { toMapPoints, MAP_POINT_SELECT } from "@/lib/map-points";
import { formatRating, STATUS_META } from "@/lib/format";
import { normaliseSubstationCode, formatSubstation } from "@/lib/substations";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return { title: `Substation ${normaliseSubstationCode(decodeURIComponent(code))}` };
}

/**
 * Everything at one substation.
 *
 * A substation is not a table in this database — it is a code carried by the
 * records that mention it (see src/lib/substations.ts for why). So this page is
 * a query, not a row: give it a code and it gathers every transformer that
 * claims to be there, plus whatever the inspection history says about the
 * substation itself.
 *
 * That is the point of making a field engineer supply the number at onboarding.
 * A pole-top unit with a substation code stops being an orphan pin and becomes
 * part of a network somebody can reason about.
 */
export default async function SubstationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requireUser();
  const { code: raw } = await params;
  const code = normaliseSubstationCode(decodeURIComponent(raw));
  if (!code) notFound();

  const [transformers, inspectionCount, named] = await Promise.all([
    prisma.transformer.findMany({
      where: { substationCode: code },
      select: { ...MAP_POINT_SELECT, substationName: true },
      orderBy: [{ status: "asc" }, { gNumber: "asc" }],
    }),
    prisma.substationInspection.count({ where: { substationCode: code } }),
    prisma.transformer.findFirst({
      where: { substationCode: code, substationName: { not: null } },
      select: { substationName: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  // A code nobody has ever written down is a 404, not an empty substation. An
  // empty page for any string typed into the URL would suggest every possible
  // substation exists.
  if (transformers.length === 0 && inspectionCount === 0) notFound();

  const name = named?.substationName ?? null;
  const points = toMapPoints(transformers);
  const faulty = transformers.filter((t) => t.status === "FAULTY").length;
  const inField = transformers.filter((t) => t.status === "IN_FIELD").length;
  const totalKva = transformers.reduce((sum, t) => sum + t.ratingKva, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/transformers" className="text-xs font-bold text-ink-soft transition-colors hover:text-kplc">
        ← All transformers
      </Link>

      <div className="rounded-2xl border border-line bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">Substation</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-navy">
          {formatSubstation(code, name)}
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {transformers.length === 1 ? "1 transformer" : `${transformers.length} transformers`} recorded here
          {inspectionCount > 0 && ` · ${inspectionCount} substation inspection${inspectionCount === 1 ? "" : "s"}`}
          {points.length < transformers.length &&
            ` · ${transformers.length - points.length} without coordinates`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Transformers" value={String(transformers.length)} />
        <StatTile label="In field" value={String(inField)} />
        <StatTile label="Faulty" value={String(faulty)} />
        <StatTile label="Installed capacity" value={`${totalKva.toLocaleString()} kVA`} />
      </div>

      {points.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="h-80">
            <TransformerMap points={points} height="20rem" zoom={15} />
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Transformers at this substation" />
        {transformers.length === 0 ? (
          <EmptyState message="This substation appears in inspection records, but no transformer is linked to it yet." />
        ) : (
          <ul className="divide-y divide-line">
            {transformers.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/transformers/${t.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-navy">
                      {t.gNumber ?? t.serialNumber}
                    </span>
                    <span className="block truncate text-xs text-ink-soft">
                      {formatRating(t.ratingKva)}
                      {t.currentSiteName ? ` · ${t.currentSiteName}` : ""}
                      {t.currentLat == null ? " · no coordinates" : ""}
                    </span>
                  </span>
                  <Badge tone={STATUS_META[t.status].tone}>{STATUS_META[t.status].label}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
