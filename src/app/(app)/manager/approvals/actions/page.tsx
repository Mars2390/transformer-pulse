import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile } from "@/components/ui";
import {
  ApprovalQueueTable,
  type PendingApproval,
} from "@/components/approvals/ApprovalQueueTable";
import { canApproveForStore, visibleTransformerWhere } from "@/lib/region-scope";
import {
  APPROVAL_ACTION_META,
  actionsSignedBy,
  isApprovalAction,
  type ApprovalAction,
} from "@/lib/approvals";
import { formatRating } from "@/lib/format";

export const metadata: Metadata = { title: "Action approvals" };
export const dynamic = "force-dynamic";

/**
 * One desk for every action that needs a signature.
 *
 * Before this page a manager's outstanding work was spread over three screens
 * — stock at /manager/approvals, consignments at /manager/batch-approvals,
 * movements at /manager/transactions/approvals — and the two actions this
 * release adds, dispatch and install, had nowhere to live at all. Nobody can
 * answer "what am I holding up?" when the answer is spread across five places,
 * two of which do not exist.
 *
 * This does not replace those three. Each remains the right screen for its own
 * kind of decision, with the context that decision needs — a consignment
 * screen has to show you the untested count, and that does not belong in a
 * generic row. This is the covering view, and it is where the paperwork lives.
 */
export default async function ActionApprovalsPage() {
  const user = await requireRole("MANAGER", "STORE_MANAGER", "ADMIN");
  const scope = visibleTransformerWhere(user);
  const signable = actionsSignedBy(user.role);

  const [pending, signedThisWeek, emergencyCount] = await Promise.all([
    prisma.approvalDocument.findMany({
      where: { status: "PENDING", transformer: scope },
      // Emergencies first — the work has already happened on those and they are
      // being ratified after the fact. Then oldest, because the longest wait is
      // the one costing somebody something.
      orderBy: [{ emergency: "desc" }, { requestedAt: "asc" }],
      take: 300,
      include: {
        transformer: {
          select: {
            id: true,
            gNumber: true,
            serialNumber: true,
            ratingKva: true,
            currentStoreId: true,
            currentStore: { select: { name: true } },
          },
        },
        requestedBy: { select: { name: true } },
      },
    }),
    prisma.approvalDocument.count({
      where: {
        status: "APPROVED",
        decidedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        transformer: scope,
      },
    }),
    prisma.approvalDocument.count({
      where: { status: "PENDING", emergency: true, transformer: scope },
    }),
  ]);

  const rows: PendingApproval[] = pending.filter((d) => isApprovalAction(d.action)).map((d) => {
    const action = d.action as ApprovalAction;
    // Three reasons a row is shown but not signable. All of them are re-checked
    // on the server per record; these exist so the person can see why.
    const blocked = !signable.includes(action)
      ? `Signed by ${APPROVAL_ACTION_META[action].approvers.join(" or ")}.`
      : !canApproveForStore(user, d.transformer.currentStoreId)
        ? "Held at another store — their manager signs this."
        : d.requestedById === user.id
          ? "You raised this one. Somebody else has to sign it."
          : null;

    return {
      id: d.id,
      reference: d.reference,
      action,
      transformerId: d.transformer.id,
      label: d.transformer.gNumber ?? d.transformer.serialNumber,
      rating: formatRating(d.transformer.ratingKva),
      storeName: d.transformer.currentStore?.name ?? null,
      contextLabel: d.contextLabel,
      justification: d.justification,
      requestedByName: d.requestedBy.name,
      requestedAt: d.requestedAt.toISOString(),
      emergency: d.emergency,
      canSign: blocked === null,
      blockedReason: blocked,
    };
  });

  const oldest = pending[0]?.requestedAt ?? null;
  const waitingDays = oldest
    ? Math.floor((Date.now() - oldest.getTime()) / 86_400_000)
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Action approvals</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Every action waiting on a signature, in one place. Approving issues an official
          certificate PDF for each unit; refusing records the reason against it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Waiting" value={rows.length} tone={rows.length ? "warning" : "success"} />
        <StatTile
          label="Longest wait"
          value={waitingDays == null ? "—" : `${waitingDays}d`}
          tone={waitingDays != null && waitingDays > 2 ? "danger" : "neutral"}
          hint={waitingDays != null && waitingDays > 2 ? "Somebody is blocked on this." : undefined}
        />
        <StatTile
          label="Ratify (emergency)"
          value={emergencyCount}
          tone={emergencyCount ? "danger" : "neutral"}
          hint={emergencyCount ? "Work already carried out." : undefined}
        />
        <StatTile label="Signed this week" value={signedThisWeek} tone="success" />
      </div>

      <Card>
        <CardHeader title="Awaiting signature" />
        <p className="-mt-2 mb-4 text-xs text-ink-soft">
          Select the rows you are signing for, then approve or refuse them together.
        </p>
        <ApprovalQueueTable approvals={rows} />
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/manager/approvals"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-navy"
        >
          Stock intake approvals →
        </Link>
        <Link
          href="/manager/batch-approvals"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-navy"
        >
          Consignment approvals →
        </Link>
        <Link
          href="/manager/transactions/approvals"
          className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-bold text-navy"
        >
          Movement approvals →
        </Link>
      </div>
    </div>
  );
}
