import type { Role } from "@/generated/prisma/enums";
import type { MovementKey } from "@/lib/transactions";

/**
 * The approval catalog.
 *
 * Every action in the fleet that a second person has to authorise is described
 * here once — its label, who may ask, who may sign, and what the certificate
 * should say. Nothing else in the codebase hand-lists these.
 *
 * That matters more than it looks. The certificate PDF prints a checklist of
 * every approvable action with one box ticked; the request PDF prints the same
 * checklist with a different box ticked; the queue groups by action; the API
 * validates the requester's role against it. Four places, and the last time
 * this project hand-listed a set of roles in four places, STORE_MANAGER
 * appeared in the dropdown and was refused by the API. One table, derived
 * everywhere.
 *
 * WHAT THIS TABLE DOES NOT DO
 * ---------------------------
 * It does not decide whether an action is permitted. The lifecycle rules,
 * the movement eligibility check and the maker-checker comparisons already do
 * that and remain authoritative. This says who may ASK and who may SIGN — the
 * paperwork question, not the safety question.
 */

export const APPROVAL_ACTIONS = [
  "STOCK_RELEASE",
  "DISPATCH",
  "INSTALL",
  "STORE_TRANSFER",
  "WORKSHOP_REPAIR",
  "WORKSHOP_RETURN",
  "SCRAP",
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export type ApprovalActionMeta = {
  /** Shown in the UI and on the PDF checklist. */
  label: string;
  /** The line under "HAS BEEN APPROVED FOR" on the certificate. */
  certificateLine: string;
  /** Who may raise this request. */
  requesters: Role[];
  /** Who may sign it off. */
  approvers: Role[];
  /** One sentence a person can act on, printed on the request. */
  description: string;
  /**
   * True when the action is enforced by an existing authoritative record
   * (a TransactionRecord, a batch, the intake maker-checker) rather than by
   * this document. Used to decide whether the document opens a request or
   * merely mirrors a decision somebody already made elsewhere.
   */
  backedByRecord: boolean;
};

export const APPROVAL_ACTION_META: Record<ApprovalAction, ApprovalActionMeta> = {
  // There is deliberately NO separate "intake testing" action here, and that
  // is worth explaining because KPLC's matrix lists Receive -> Test as its own
  // approval step.
  //
  // It already is one. `LIFECYCLE_RULES.TESTED.allowedFrom` is ["IN_STORE"],
  // and recordEvent refuses TESTED on a PENDING_APPROVAL unit by name:
  // "Someone other than the officer who booked it in has to accept it into
  // stock before it can be tested or dispatched." So the intake maker-checker
  // IS the gate between receiving and testing — the same signature, already
  // enforced, already producing a certificate.
  //
  // Adding a second action would have put a THIRD signature in front of a unit
  // that already needs two, gating nothing that was not gated, and printing a
  // tick box on every certificate that no workflow could ever tick. A
  // checklist line nobody can select is the same defect as a blank field shown
  // as a measurement: paperwork asserting something the system cannot back up.
  //
  // The test page instead SHOWS the stock-release certificate that authorised
  // the testing, which is the audit trail the matrix row is actually asking for.
  STOCK_RELEASE: {
    label: "Stock Release",
    certificateLine: "Release into serviceable stock, and intake testing",
    requesters: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    description:
      "Accepts the unit into serviceable stock. It may be intake-tested and then dispatched.",
    backedByRecord: true,
  },
  DISPATCH: {
    label: "Dispatch to Field",
    certificateLine: "Dispatch to the field",
    // FIELD_ENGINEER is here because MOVEMENTS.WORKSHOP_TO_SITE — taking a
    // repaired unit straight from the workshop to a pole — lists them.
    requesters: ["STORE_KEEPER", "FIELD_ENGINEER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    description:
      "Authorises the unit to leave the store on a vehicle, to a named destination and a named engineer.",
    backedByRecord: false,
  },
  INSTALL: {
    label: "Installation",
    certificateLine: "Installation and energising on site",
    requesters: ["FIELD_ENGINEER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    description:
      "Authorises the engineer to install and energise the unit at the site it was dispatched to.",
    backedByRecord: false,
  },
  STORE_TRANSFER: {
    label: "Transfer between stores",
    certificateLine: "Transfer between stores",
    // MANAGER is here because MOVEMENTS.STORE_TO_MANUFACTURER — a return to the
    // supplier, which maps to this action — already lists MANAGER as an
    // initiator. An end-to-end test caught the mismatch: a manager could raise
    // the movement and then be told by this API that raising it was not their
    // job. That is the STORE_MANAGER-in-the-dropdown failure again, in a new
    // place, which is why both tables now get exercised against each other.
    // FIELD_ENGINEER is here because MOVEMENTS.SITE_TO_STORE — recovering a
    // unit off a pole back into store custody — lists them as an initiator.
    requesters: ["STORE_KEEPER", "STORE_MANAGER", "MANAGER", "FIELD_ENGINEER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    description: "Moves the unit from one store's or site's custody to another's.",
    backedByRecord: true,
  },
  WORKSHOP_REPAIR: {
    label: "Send to Workshop",
    certificateLine: "Recovery to workshop for repair",
    // Widened alongside MOVEMENTS.SITE_TO_WORKSHOP — a recovery may be raised
    // by anybody with authority over the stock, with the engineer at the pole
    // named on it. The cross-catalog test in scripts/verify-approvals.mts is
    // what keeps these two lists in step.
    requesters: ["FIELD_ENGINEER", "STORE_KEEPER", "STORE_MANAGER", "MANAGER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    description: "Recovers a failed or suspect unit from site or store to a workshop.",
    backedByRecord: true,
  },
  WORKSHOP_RETURN: {
    label: "Return from Workshop",
    certificateLine: "Return from workshop to store",
    requesters: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    description: "Returns a repaired unit from the workshop into store custody.",
    backedByRecord: true,
  },
  SCRAP: {
    label: "Condemn / Scrap",
    certificateLine: "Condemnation and disposal",
    requesters: ["FIELD_ENGINEER", "STORE_KEEPER", "STORE_MANAGER", "MANAGER", "ADMIN"],
    // NOT store managers, and this is the one place the two catalogs were
    // reconciled by TIGHTENING rather than widening.
    //
    // MOVEMENTS previously let a STORE_MANAGER approve SITE_TO_SCRAP and
    // WORKSHOP_TO_SCRAP, which is the only irreversible decision in the whole
    // lifecycle — there is no event that brings a SCRAPPED unit back. A store
    // manager's authority is their own store; writing an asset off the fleet
    // register is a regional decision. MOVEMENTS was changed to match this,
    // not the other way round.
    approvers: ["MANAGER", "ADMIN"],
    description:
      "Permanently removes the unit from the fleet. There is no route back from this one.",
    backedByRecord: true,
  },
};

/**
 * Which approval a movement corresponds to.
 *
 * A movement already carries its own approval on the TransactionRecord. This
 * mapping exists so the document raised alongside it prints under the right
 * heading rather than under a generic "Transfer" for all eleven.
 */
export const MOVEMENT_ACTION: Record<MovementKey, ApprovalAction> = {
  MANUFACTURER_TO_STORE: "STOCK_RELEASE",
  STORE_TO_STORE: "STORE_TRANSFER",
  STORE_TO_SITE: "DISPATCH",
  STORE_TO_WORKSHOP: "WORKSHOP_REPAIR",
  SITE_TO_WORKSHOP: "WORKSHOP_REPAIR",
  SITE_TO_STORE: "STORE_TRANSFER",
  WORKSHOP_TO_STORE: "WORKSHOP_RETURN",
  WORKSHOP_TO_SITE: "DISPATCH",
  STORE_TO_MANUFACTURER: "STORE_TRANSFER",
  SITE_TO_SCRAP: "SCRAP",
  WORKSHOP_TO_SCRAP: "SCRAP",
};

export const APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "SUPERSEDED",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_STATUS_META: Record<
  ApprovalStatus,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  PENDING: { label: "Pending approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
};

export function isApprovalAction(value: string): value is ApprovalAction {
  return (APPROVAL_ACTIONS as readonly string[]).includes(value);
}

export function canRequest(action: ApprovalAction, role: Role): boolean {
  return APPROVAL_ACTION_META[action].requesters.includes(role);
}

export function canSign(action: ApprovalAction, role: Role): boolean {
  return APPROVAL_ACTION_META[action].approvers.includes(role);
}

/** Which actions a given role is ever asked to sign. Drives the queue filter. */
export function actionsSignedBy(role: Role): ApprovalAction[] {
  return APPROVAL_ACTIONS.filter((a) => canSign(a, role));
}

/**
 * APR-2026-00042.
 *
 * Sequence is per calendar year and allocated from a count, which is
 * technically racy under simultaneous requests — two clerks pressing the
 * button in the same millisecond could both compute 42. The `reference` column
 * is UNIQUE, so the loser gets a constraint violation rather than a duplicate
 * document, and `nextReference` retries. A gap in the numbering is survivable;
 * two certificates numbered APR-2026-00042 is not.
 */
export function formatApprovalRef(year: number, sequence: number): string {
  return `APR-${year}-${String(sequence).padStart(5, "0")}`;
}
