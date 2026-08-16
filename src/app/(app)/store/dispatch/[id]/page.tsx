import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DispatchForm } from "@/components/store/DispatchForm";
import { RequestApprovalPanel } from "@/components/approvals/RequestApprovalPanel";
import { currentApproval } from "@/lib/approval-store";

export const metadata: Metadata = { title: "Dispatch" };
export const dynamic = "force-dynamic";

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("STORE_KEEPER", "ADMIN");
  const { id } = await params;

  const [transformer, stores, engineerRows, approval] = await Promise.all([
    prisma.transformer.findUnique({
      where: { id },
      include: {
        tests: { where: { stage: "STORE_INTAKE" }, orderBy: { testedAt: "desc" }, take: 1 },
      },
    }),
    prisma.store.findMany({ select: { region: true } }),
    // Active-task count is what a store keeper needs to avoid piling a fifth
    // delivery on somebody already holding four. Counted per engineer in one
    // grouped query rather than a query per row.
    prisma.user.findMany({
      where: { role: "FIELD_ENGINEER", active: true },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
        _count: { select: { assignedTransformers: true } },
      },
      orderBy: { name: "asc" },
    }),
    currentApproval(id, "DISPATCH"),
  ]);

  if (!transformer) notFound();

  const intake = transformer.tests[0];

  // The engine would refuse this anyway. Catching it here means the keeper sees
  // WHY on a calm page, rather than filling a whole form and being rejected.
  if (!intake || !intake.passed) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link href="/store/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Store
        </Link>
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-6">
          <h1 className="text-lg font-bold text-red-900">
            This transformer cannot be dispatched
          </h1>
          <p className="mt-2 text-sm text-red-800">
            {!intake
              ? "It has not had its intake test yet. Nothing leaves this store untested."
              : "It failed its intake test. Sending it to a pole would mean a return trip, an outage, and a claim."}
          </p>
          <Link
            href={`/store/test/${transformer.id}`}
            className="mt-4 inline-block rounded-xl bg-kplc px-5 py-2.5 text-sm font-bold text-white"
          >
            {intake ? "Record another test" : "Record the intake test"}
          </Link>
        </div>
      </div>
    );
  }

  const regions = [...new Set(stores.map((s) => s.region))].sort();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/store/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
        ← Store
      </Link>

      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">
        Dispatch to field
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        A dispatch needs a manager's signature before the unit leaves the store. Once it is
        approved, record who is carrying it, on what, and where to.
      </p>

      <div className="mt-6">
        <RequestApprovalPanel
          transformerId={transformer.id}
          action="DISPATCH"
          contextLabel={transformer.currentSiteName ?? user.region ?? null}
          current={
            approval
              ? {
                  id: approval.id,
                  reference: approval.reference,
                  status: approval.status as "PENDING" | "APPROVED",
                  requestedByName: approval.requestedBy.name,
                  requestedAt: approval.requestedAt.toISOString(),
                  decidedByName: approval.decidedBy?.name ?? null,
                  decidedAt: approval.decidedAt?.toISOString() ?? null,
                }
              : null
          }
        >
        <DispatchForm
          engineers={engineerRows.map((e) => ({
            id: e.id,
            name: e.name,
            email: e.email,
            region: e.region,
            activeTasks: e._count.assignedTransformers,
          }))}
          transformerId={transformer.id}
          gNumber={transformer.gNumber}
          serialNumber={transformer.serialNumber}
          ratingKva={transformer.ratingKva}
          regions={regions}
          defaultRegion={user.region ?? regions[0] ?? "Nairobi North"}
        />
        </RequestApprovalPanel>
      </div>
    </div>
  );
}
