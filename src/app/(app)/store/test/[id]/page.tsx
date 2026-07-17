import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IntakeTestForm } from "@/components/store/IntakeTestForm";
import { Badge } from "@/components/ui";
import { formatDate, formatRating, STATUS_META } from "@/lib/format";

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

  const transformer = await prisma.transformer.findUnique({
    where: { id },
    include: {
      manufacturer: { select: { name: true, warrantyMonths: true } },
      tests: { orderBy: { testedAt: "desc" } },
    },
  });

  if (!transformer) notFound();

  const alreadyTested = transformer.tests.some((t) => t.stage === "STORE_INTAKE");

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/store/dashboard"
        className="text-xs font-bold text-ink-soft transition-colors hover:text-kplc"
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
