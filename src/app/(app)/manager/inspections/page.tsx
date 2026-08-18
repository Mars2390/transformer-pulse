import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, EmptyState, Badge } from "@/components/ui";
import { regionWhere } from "@/lib/region-scope";
import type { Prisma } from "@/generated/prisma/client";
import type { StructureCondition } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Inspection register" };
export const dynamic = "force-dynamic";

const MATCH_LABEL: Record<string, string> = {
  G_NUMBER: "matched on G-Number",
  SERIAL: "matched on serial",
  SUBSTATION_CODE: "matched on substation",
  MANUAL: "matched by hand",
  UNRESOLVED: "not yet on the register",
};

/** A pole that is not sound. Typed, so Prisma's enum filter accepts it. */
const BAD_STRUCTURE: StructureCondition[] = ["LEANING", "ROTTEN"];

const STRUCTURE_TONE: Record<string, "success" | "warning" | "danger"> = {
  OKAY: "success",
  LEANING: "warning",
  ROTTEN: "danger",
};

/**
 * The imported inspection register, as rows.
 *
 * The import screen ended with a "View inspections" button that went nowhere:
 * once a file was committed, the only way to see any of it was to already know
 * which transformer to open. That is backwards — the register is the evidence
 * the import produced, and the first thing anyone wants after a commit is to
 * look at what landed.
 *
 * Rows that did not match a transformer are shown here too, not hidden. An
 * unmatched row is not a failure to be swept up: it is a real inspection of a
 * real substation that this register does not know about yet, and /manager/staging
 * is where it becomes an asset.
 */
export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireRole("MANAGER", "ADMIN");
  const sp = await searchParams;

  // Region scoping is applied to the inspection's OWN region column: an
  // unmatched row has no transformer to scope through, and dropping those from
  // a manager's view is what would make the count on this page disagree with
  // the count on the import screen.
  const scope = regionWhere(user.region, user.role);

  const filter = sp.filter;
  const where: Prisma.SubstationInspectionWhereInput = {
    ...scope,
    ...(filter === "review" ? { needsReview: true } : {}),
    ...(filter === "unmatched" ? { transformerId: null } : {}),
    ...(filter === "defect"
      ? { OR: [{ structure: { in: BAD_STRUCTURE } }, { loadingOk: false }] }
      : {}),
  };

  const [rows, total, needsReview, unmatched, defects] = await Promise.all([
    prisma.substationInspection.findMany({
      where,
      orderBy: [{ inspectedOn: "desc" }, { reportId: "desc" }],
      take: 500,
      select: {
        id: true,
        reportId: true,
        inspectedOn: true,
        substationCode: true,
        substationName: true,
        region: true,
        inspectorRef: true,
        matchedBy: true,
        transformerId: true,
        structure: true,
        loadingOk: true,
        loadAction: true,
        needsReview: true,
        reviewReasons: true,
        transformer: { select: { id: true, gNumber: true, serialNumber: true } },
      },
    }),
    prisma.substationInspection.count({ where: scope }),
    prisma.substationInspection.count({ where: { ...scope, needsReview: true } }),
    prisma.substationInspection.count({ where: { ...scope, transformerId: null } }),
    prisma.substationInspection.count({
      where: {
        ...scope,
        OR: [{ structure: { in: BAD_STRUCTURE } }, { loadingOk: false }],
      },
    }),
  ]);

  const chip = (key: string | undefined, label: string, count: number) => {
    const active = filter === key;
    return (
      <Link
        key={label}
        href={key ? `/manager/inspections?filter=${key}` : "/manager/inspections"}
        className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-xs font-bold ${
          active ? "border-kplc bg-kplc text-white" : "border-line bg-white text-navy hover:border-kplc"
        }`}
      >
        {label} · {count}
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Inspection register</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-ink-soft">
            Every inspection form imported from KPLC&apos;s register, as recorded. Nothing here has been
            written back onto a transformer — where a form disagrees with the asset record, that is a
            conflict rather than an overwrite.
          </p>
        </div>
        <Link
          href="/manager/inspections/import"
          className="inline-flex min-h-11 items-center rounded-lg bg-kplc px-4 text-xs font-bold text-white hover:bg-kplc-dark"
        >
          Import a register
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Inspections imported" value={String(total)} />
        <StatTile label="Needs review" value={String(needsReview)} tone={needsReview ? "warning" : "neutral"} />
        <StatTile label="Not on the register" value={String(unmatched)} tone={unmatched ? "info" : "neutral"} />
        <StatTile label="Defect recorded" value={String(defects)} tone={defects ? "danger" : "neutral"} />
      </div>

      <div className="flex flex-wrap gap-2">
        {chip(undefined, "All", total)}
        {chip("review", "Needs review", needsReview)}
        {chip("unmatched", "Not on the register", unmatched)}
        {chip("defect", "Defect recorded", defects)}
      </div>

      <Card>
        <CardHeader
          title={`${rows.length} shown${rows.length === 500 ? " (most recent 500)" : ""}`}
          action={
            unmatched > 0 ? (
              <Link href="/manager/staging" className="inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline">
                Promote unmatched →
              </Link>
            ) : undefined
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            message={
              total === 0
                ? "No inspection register has been imported yet."
                : "Nothing matches this filter."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-navy">
                    {r.substationCode}
                    {r.substationName ? ` — ${r.substationName}` : ""}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    {r.inspectedOn.toISOString().slice(0, 10)} · report #{r.reportId} · inspector{" "}
                    {r.inspectorRef} · {MATCH_LABEL[r.matchedBy] ?? r.matchedBy}
                    {r.region ? ` · ${r.region}` : ""}
                  </p>
                  {r.needsReview && r.reviewReasons.length > 0 && (
                    <p className="mt-1 truncate text-xs font-semibold text-amber-800">
                      {r.reviewReasons.join("; ")}
                    </p>
                  )}
                </div>

                {r.structure && (
                  <Badge tone={STRUCTURE_TONE[r.structure] ?? "neutral"}>{r.structure}</Badge>
                )}
                {r.loadingOk === false && (
                  <Badge tone="danger">Overloaded{r.loadAction ? ` · ${r.loadAction}` : ""}</Badge>
                )}

                {r.transformer ? (
                  <Link
                    href={`/transformers/${r.transformer.id}`}
                    className="inline-flex min-h-11 items-center text-xs font-bold text-kplc hover:underline"
                  >
                    {r.transformer.gNumber ?? r.transformer.serialNumber}
                  </Link>
                ) : (
                  <Link href="/manager/staging" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
                    Not on the register →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
