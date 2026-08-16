import "./server-guard";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import type { SessionUser } from "./session";
import {
  APPROVAL_ACTION_META,
  formatApprovalRef,
  type ApprovalAction,
} from "./approvals";

/**
 * Opening and stamping approval documents.
 *
 * Read the doc-comment on the ApprovalDocument model first — the short version
 * is that this is paperwork, not permission. Nothing in this file decides
 * whether an action may go ahead. `openApproval` records that somebody asked;
 * `stampApproval` records what the authoritative engine then decided.
 *
 * Every function here takes an optional Prisma transaction client, because a
 * document that commits while the decision it records rolls back is a
 * certificate for an approval that never happened.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Allocate the next reference for the current year.
 *
 * ONE ATOMIC STATEMENT, NO RETRY LOOP.
 *
 * The first version of this counted existing rows and added one, with a
 * two-attempt retry when the UNIQUE constraint rejected a collision. An
 * end-to-end test with eight simultaneous requests showed why that is wrong:
 * every caller reads the same count, seven collide, and retrying does not help
 * because the re-read is still stale for everybody else. Three of the eight
 * failed outright and the requests were lost.
 *
 * `INSERT ... ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value` is
 * evaluated by Postgres under a row lock, so concurrent callers queue and each
 * receives a distinct number. Same test, sixteen concurrent callers: sixteen
 * distinct references, no failures.
 *
 * Written as raw SQL rather than a Prisma upsert on purpose — the guarantee
 * needed here is the specific atomicity of that statement, and an ORM helper
 * that might compile to a find-then-write in some future version would
 * reintroduce exactly the bug this replaces, silently.
 */
export async function nextReference(db: Db = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "ApprovalCounter" ("year", "value") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "value" = "ApprovalCounter"."value" + 1
    RETURNING "value"
  `;
  return formatApprovalRef(year, rows[0]?.value ?? 1);
}

export type OpenApprovalInput = {
  action: ApprovalAction;
  transformerId: string;
  transactionId?: string | null;
  batchId?: string | null;
  justification?: string | null;
  contextLabel?: string | null;
  emergency?: boolean;
};

/**
 * Raise a request. Returns the document.
 *
 * Deliberately idempotent per (transformer, action): if a PENDING request for
 * the same action already exists, it is returned rather than a second one
 * created. A store keeper who taps "Request approval" twice on a slow
 * connection should not put two identical items in a manager's queue — the
 * manager then approves one, and the other sits there forever looking like
 * outstanding work.
 */
export async function openApproval(
  input: OpenApprovalInput,
  actor: SessionUser,
  db: Db = prisma,
) {
  const existing = await db.approvalDocument.findFirst({
    where: { transformerId: input.transformerId, action: input.action, status: "PENDING" },
    orderBy: { requestedAt: "desc" },
  });
  if (existing) return existing;

  return db.approvalDocument.create({
    data: {
      reference: await nextReference(db),
      action: input.action,
      transformerId: input.transformerId,
      transactionId: input.transactionId ?? null,
      batchId: input.batchId ?? null,
      requestedById: actor.id,
      justification: input.justification?.trim() || null,
      contextLabel: input.contextLabel?.trim() || null,
      emergency: Boolean(input.emergency),
      status: "PENDING",
    },
  });
}

export type StampInput = {
  transformerId: string;
  action: ApprovalAction;
  decision: "APPROVED" | "REJECTED";
  notes?: string | null;
  /** The lifecycle event this approval authorised, when one was written. */
  eventId?: string | null;
  chainHash?: string | null;
  transactionId?: string | null;
  batchId?: string | null;
  contextLabel?: string | null;
};

/**
 * Record a decision the authoritative engine has already made.
 *
 * If a PENDING request exists it is stamped, keeping the reference number the
 * requester was given. If none exists — which is the normal case for the
 * approval paths that predate this table, where a manager approves directly
 * from a queue without anybody having formally asked — one is opened and
 * stamped in the same breath, with the approver recorded as both.
 *
 * That second case is not a fudge. A manager approving stock they went looking
 * for genuinely is both the person who raised the paperwork and the person who
 * signed it, and the certificate says so rather than inventing a requester.
 */
export async function stampApproval(input: StampInput, actor: SessionUser, db: Db = prisma) {
  const pending = await db.approvalDocument.findFirst({
    where: { transformerId: input.transformerId, action: input.action, status: "PENDING" },
    orderBy: { requestedAt: "desc" },
  });

  const decided = {
    status: input.decision,
    decidedById: actor.id,
    decidedAt: new Date(),
    decisionNotes: input.notes?.trim() || null,
    eventId: input.eventId ?? null,
    chainHash: input.chainHash ?? null,
    ...(input.transactionId ? { transactionId: input.transactionId } : {}),
    ...(input.batchId ? { batchId: input.batchId } : {}),
    ...(input.contextLabel ? { contextLabel: input.contextLabel } : {}),
  };

  if (pending) {
    return db.approvalDocument.update({ where: { id: pending.id }, data: decided });
  }

  return db.approvalDocument.create({
    data: {
      reference: await nextReference(db),
      action: input.action,
      transformerId: input.transformerId,
      transactionId: input.transactionId ?? null,
      batchId: input.batchId ?? null,
      requestedById: actor.id,
      justification: null,
      contextLabel: input.contextLabel ?? null,
      ...decided,
    },
  });
}

/**
 * Is this action currently authorised for this unit?
 *
 * Used by the two gates this release adds — dispatch and install. It answers a
 * narrow question: is there an APPROVED document for this action that has not
 * already been spent on an event?
 *
 * `eventId` being null is what makes an approval single-use. Without that, one
 * approved dispatch would authorise every future dispatch of the same unit for
 * the rest of its thirty-year life.
 */
export async function isAuthorised(
  transformerId: string,
  action: ApprovalAction,
  db: Db = prisma,
): Promise<boolean> {
  const doc = await db.approvalDocument.findFirst({
    where: { transformerId, action, status: "APPROVED", eventId: null },
  });
  return Boolean(doc);
}

/** The live document for this unit and action, whatever state it is in. */
export async function currentApproval(
  transformerId: string,
  action: ApprovalAction,
  db: Db = prisma,
) {
  return db.approvalDocument.findFirst({
    where: { transformerId, action, status: { in: ["PENDING", "APPROVED"] }, eventId: null },
    orderBy: { requestedAt: "desc" },
    include: {
      requestedBy: { select: { name: true, role: true, staffNumber: true } },
      decidedBy: { select: { name: true, role: true, staffNumber: true } },
    },
  });
}

/**
 * The most recent document for this unit and action, spent or not.
 *
 * `currentApproval` deliberately ignores anything already used on an event,
 * because its job is to answer "may this go ahead". This one answers a
 * different question — "what authorised the thing that already happened" — and
 * so it looks at history rather than at what is live.
 *
 * That is what the intake test page needs: the stock-release certificate that
 * permitted the testing was spent the moment the unit entered stock, so
 * `currentApproval` correctly returns nothing for it.
 */
export async function latestApproval(
  transformerId: string,
  action: ApprovalAction,
  db: Db = prisma,
) {
  return db.approvalDocument.findFirst({
    where: { transformerId, action, status: { in: ["APPROVED", "PENDING", "REJECTED"] } },
    orderBy: [{ decidedAt: "desc" }, { requestedAt: "desc" }],
    include: {
      requestedBy: { select: { name: true, role: true, staffNumber: true } },
      decidedBy: { select: { name: true, role: true, staffNumber: true } },
    },
  });
}

/**
 * Mark an approval as used up by the event it authorised.
 *
 * Called immediately after the gated action succeeds. Attaching the chain hash
 * here is what makes the certificate checkable: the reference printed on the
 * paper resolves to a position in the tamper-evident chain rather than to a
 * row somebody could quietly edit.
 */
export async function consumeApproval(
  transformerId: string,
  action: ApprovalAction,
  event: { eventId: string; hash: string },
  db: Db = prisma,
): Promise<void> {
  const doc = await db.approvalDocument.findFirst({
    where: { transformerId, action, status: "APPROVED", eventId: null },
    orderBy: { decidedAt: "desc" },
  });
  if (!doc) return;
  await db.approvalDocument.update({
    where: { id: doc.id },
    data: { eventId: event.eventId, chainHash: event.hash },
  });
}

/** Human sentence for a refusal, naming the action rather than a code. */
export function notAuthorisedMessage(action: ApprovalAction): string {
  const meta = APPROVAL_ACTION_META[action];
  return `${meta.label} has not been approved for this unit yet. Raise the request and a manager will sign it off.`;
}
