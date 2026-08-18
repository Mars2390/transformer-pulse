import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IntakeTestForm } from "@/components/store/IntakeTestForm";
import { Badge } from "@/components/ui";
import { formatDate, formatDateTime, formatRating, ROLE_LABELS, STATUS_META } from "@/lib/format";
import { latestApproval } from "@/lib/approval-store";

export const metadata: Metadata = { title: "Intake test" };
export const dynamic = "force-dynamic";

export default async function IntakeTestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ received?: string }>;
}) {
  await requireRole("STORE_KEEPER", "ADMIN");
  const { id } = await params;
  const { received } = await searchParams;

  const [transformer, authority] = await Promise.all([
    prisma.transformer.findUnique({
      where: { id },
      include: {
        manufacturer: { select: { name: true, warrantyMonths: true } },
        tests: { orderBy: { testedAt: "desc" } },
      },
    }),
    // The certificate that permitted this unit to be tested at all. Spent
    // already, so `currentApproval` correctly returns nothing for it — see
    // latestApproval's doc comment.
    latestApproval(id, "STOCK_RELEASE"),
  ]);

  if (!transformer) notFound();

  const alreadyTested = transformer.tests.some((t) => t.stage === "STORE_INTAKE");

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/store/dashboard"
        className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft transition-colors hover:text-kplc"
      >
        ← Store
      </Link>

      {received && (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Registered. It is now on the store floor — record its intake test to
          clear it for dispatch.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy">
            Intake test
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span className="font-mono font-bold text-navy">
              {transformer.gNumber ?? transformer.serialNumber}
            </span>
            <span>·</span>
            <span>{formatRating(transformer.ratingKva)}</span>
            <span>·</span>
            <span>{transformer.manufacturer.name}</span>
            <span>·</span>
            <span>received {formatDate(transformer.createdAt)}</span>
          </p>
        </div>
        <Badge tone={STATUS_META[transformer.status].tone}>
          {STATUS_META[transformer.status].label}
        </Badge>
      </div>

      {/* Authority to test.
          KPLC's matrix lists "Receive -> Test" as its own approval step. It
          already is one: TESTED is only allowed from IN_STORE, and a unit only
          reaches IN_STORE when somebody other than the officer who booked it in
          accepts it. That signature is what permitted this screen to exist, so
          it is shown here rather than a second one being demanded. */}
      {authority?.status === "APPROVED" ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="text-xs font-bold text-emerald-900">Testing authorised</span>
          <span className="font-mono text-xs font-bold text-emerald-900">{authority.reference}</span>
          <span className="text-xs text-emerald-800">
            {authority.decidedBy?.name ?? "a manager"}
            {authority.decidedBy ? ` · ${ROLE_LABELS[authority.decidedBy.role]}` : ""}
            {authority.decidedAt ? ` · ${formatDateTime(authority.decidedAt)}` : ""}
          </span>
          <a
            href={`/api/pdf/approval/${authority.id}`}
            className="ml-auto rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-bold text-emerald-900"
          >
            Download Approval PDF
          </a>
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          No stock-release certificate is on file for this unit. It predates the approval document
          system, or it was accepted into stock before certificates were issued. Testing is still
          permitted — the lifecycle rules already refused it until somebody accepted it into stock —
          but there is no printable authority for this one.
        </p>
      )}

      {!transformer.gNumber && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This unit has no G-Number yet. It can still be tested, but it is not
          fully on the register until one is assigned.
        </p>
      )}

      {alreadyTested && (
        <p className="mt-4 rounded-xl border border-kplc/20 bg-kplc/5 px-4 py-3 text-sm text-navy">
          An intake test already exists for this unit. Recording another adds a
          new test to its history — it does not replace the old one. Nothing in
          this system is ever overwritten.
        </p>
      )}

      <div className="mt-6">
        <IntakeTestForm
          transformerId={transformer.id}
          gNumber={transformer.gNumber}
          serialNumber={transformer.serialNumber}
        />
      </div>
    </div>
  );
}
