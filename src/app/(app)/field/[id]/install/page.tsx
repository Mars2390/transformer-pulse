import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFieldTransformer } from "@/lib/field-load";
import { InstallForm } from "@/components/field/InstallForm";
import { RequestApprovalPanel } from "@/components/approvals/RequestApprovalPanel";
import { currentApproval } from "@/lib/approval-store";

export const dynamic = "force-dynamic";

/**
 * Install, in the order KPLC asked for: receipt, then approval, then work.
 *
 * CONFIRM RECEIPT FIRST. An installation approval raised before the engineer
 * has physically taken delivery is approval to install something that might
 * still be on a lorry, or on a different lorry. The receipt is the moment the
 * unit becomes theirs to speak for, so until RECEIVED_BY_FIELD is on the chain
 * this page sends them to confirm it and does not offer the request.
 *
 * The gate itself is enforced in the API, not here. This page shapes the
 * sequence; `/api/transformers/[id]/install` is what actually refuses.
 */
export default async function InstallPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");
  const { id } = await params;

  const [tx, approval, receipt] = await Promise.all([
    loadFieldTransformer(id, user.region),
    currentApproval(id, "INSTALL"),
    prisma.lifecycleEvent.findFirst({
      where: { transformerId: id, type: "RECEIVED_BY_FIELD" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, user: { select: { name: true } } },
    }),
  ]);
  if (!tx) notFound();

  const approved = approval?.status === "APPROVED";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/field/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
        ← My work
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">Install transformer</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Confirm receipt, get the installation signed off, then photo, GPS and commissioning test.
      </p>

      {/* Step 1 — receipt. Without it there is nothing to approve. */}
      {!receipt ? (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <p className="text-sm font-extrabold text-amber-900">Confirm receipt first</p>
          <p className="mt-1.5 text-xs text-amber-800">
            You have not signed for this unit yet. Approval to install is approval to energise{" "}
            <em>this</em> transformer at <em>this</em> site — which nobody can give until you have
            taken delivery of it. It takes a moment, and it is what puts your name on the chain.
          </p>
          <Link
            href={`/field/${id}/receive`}
            className="mt-4 inline-block rounded-xl bg-kplc px-5 py-2.5 text-sm font-bold text-white"
          >
            Confirm receipt →
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900">
            Receipt confirmed by {receipt.user.name} on{" "}
            {receipt.occurredAt.toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
            .
          </p>

          {/* Steps 2 and 3 — request, then the work. */}
          <div className="mt-5">
            <RequestApprovalPanel
              transformerId={id}
              action="INSTALL"
              contextLabel={tx.currentSiteName}
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
            />
          </div>

          {/* The form renders whatever the approval state is, because the
              emergency path lives inside it. What changes is the banner at the
              top, the colour of the submit button and what it says. A form that
              refuses to appear is a form somebody works around by writing the
              install on paper and typing it in on Friday — which loses the GPS,
              the photo and the commissioning test. */}
          <div className="mt-6">
            <InstallForm
              transformerId={tx.id}
              gNumber={tx.gNumber}
              serialNumber={tx.serialNumber}
              detail={tx.detail}
              suggestedSite={tx.currentSiteName}
              releasedUntested={Boolean(tx.batchId) && !tx.sampleTested}
              approved={approved}
            />
          </div>
        </>
      )}
    </div>
  );
}
