import "./server-guard";
import { prisma } from "./prisma";
import type { SessionUser } from "./session";
import { visibleBatchWhere, visibleTransformerWhere } from "./region-scope";
import { actionsSignedBy } from "./approvals";

/**
 * How much work is waiting on this person's signature, right now.
 *
 * COUNTED ON READ. NEVER STORED. This is the single most important decision in
 * the notification system and it is worth being explicit about, because the
 * obvious implementation is the wrong one.
 *
 * The obvious implementation writes an Alert row saying "3 approvals pending".
 * That row is wrong the instant somebody approves one of the three, so it needs
 * clearing — and clearing means every approve, reject, withdraw, supersede,
 * bulk-decide and cascade path has to remember to call the cleanup. The day one
 * of them forgets, a manager stares at a red badge over an empty queue, decides
 * the badge lies, and stops looking at it. A notification nobody trusts is
 * worse than no notification, because it also hides the real ones.
 *
 * Counting on read cannot go stale. There is nothing to clean up, so there is
 * nothing to forget to clean up. Approve the last item and the badge is gone on
 * the next poll with no code anywhere having been told to remove it.
 *
 * This is the same reasoning that made the 48-hour engineer overdue warning
 * derived rather than scheduled: an alert that depends on a job somebody has to
 * remember to run is worse than no alert at all.
 *
 * The cost is four indexed COUNT queries per poll. That is the right trade for
 * a number that is never wrong.
 */

export type PendingApprovals = {
  /** Units booked in and waiting for a second person to accept them. */
  intake: number;
  /** Movements raised and waiting for authority to travel. */
  movements: number;
  /** Whole consignments waiting for release. */
  batches: number;
  /** Action approvals — dispatch, install and the rest — waiting for signature. */
  actions: number;
  /** Emergency installs already carried out, waiting to be ratified. */
  ratifications: number;
  total: number;
  /** One sentence per non-zero kind, with where to go and act on it. */
  items: { label: string; count: number; href: string; urgent: boolean }[];
};

const EMPTY: PendingApprovals = {
  intake: 0,
  movements: 0,
  batches: 0,
  actions: 0,
  ratifications: 0,
  total: 0,
  items: [],
};

export async function countPendingApprovals(user: SessionUser): Promise<PendingApprovals> {
  // Only the roles that actually sign things. A store keeper's bell should not
  // carry a count they can do nothing about — that is noise dressed as
  // information, and it trains people to ignore the badge.
  if (user.role !== "MANAGER" && user.role !== "STORE_MANAGER" && user.role !== "ADMIN") {
    return EMPTY;
  }

  // A store manager's scope is a foreign key, a regional manager's is a region.
  // `visibleTransformerWhere` already branches on that and fails CLOSED for a
  // store manager with no store — see its own doc comment. Using regionWhere
  // here would have shown a Ruaraka store manager every pending approval in
  // Nairobi North, every other store included.
  const scope = visibleTransformerWhere(user);
  const signable = actionsSignedBy(user.role);

  const [intake, movements, batches, actions, ratifications] = await Promise.all([
    prisma.transformer.count({
      where: {
        ...scope,
        status: "PENDING_APPROVAL",
        // Maker-checker: work you raised yourself is not work waiting on you.
        // Counting it would show a manager a number they cannot reduce.
        NOT: { submittedById: user.id },
      },
    }),
    prisma.transactionRecord.count({
      where: {
        status: "PENDING_APPROVAL",
        transformer: scope,
        NOT: { initiatedById: user.id },
      },
    }),
    prisma.transformerBatch.count({
      where: {
        status: "PENDING_APPROVAL",
        NOT: { receivedById: user.id },
        // A batch's region lives on its STORE, one level down from every other
        // scope here. Getting that wrong shows a Nairobi manager Mombasa's
        // consignment count, which is the kind of wrong number nobody reports
        // because it looks plausible.
        ...visibleBatchWhere(user),
      },
    }),
    prisma.approvalDocument.count({
      where: {
        status: "PENDING",
        emergency: false,
        action: { in: signable },
        transformer: scope,
        NOT: { requestedById: user.id },
      },
    }),
    prisma.approvalDocument.count({
      where: {
        status: "PENDING",
        emergency: true,
        action: { in: signable },
        transformer: scope,
        NOT: { requestedById: user.id },
      },
    }),
  ]);

  const items = [
    {
      label: `${ratifications} emergency ${ratifications === 1 ? "install" : "installs"} to ratify`,
      count: ratifications,
      href: "/manager/approvals/actions",
      urgent: true,
    },
    {
      label: `${intake} ${intake === 1 ? "transformer" : "transformers"} awaiting intake approval`,
      count: intake,
      href: "/manager/approvals",
      urgent: false,
    },
    {
      label: `${movements} ${movements === 1 ? "movement" : "movements"} awaiting approval`,
      count: movements,
      href: "/manager/transactions/approvals",
      urgent: false,
    },
    {
      label: `${batches} ${batches === 1 ? "consignment" : "consignments"} awaiting release`,
      count: batches,
      href: "/manager/batch-approvals",
      urgent: false,
    },
    {
      label: `${actions} ${actions === 1 ? "action" : "actions"} awaiting signature`,
      count: actions,
      href: "/manager/approvals/actions",
      urgent: false,
    },
  ].filter((i) => i.count > 0);

  return {
    intake,
    movements,
    batches,
    actions,
    ratifications,
    total: intake + movements + batches + actions + ratifications,
    items,
  };
}
