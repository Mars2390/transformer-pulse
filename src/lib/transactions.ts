import type { EventType, Role, TransformerStatus } from "@/generated/prisma/enums";

/**
 * Every way a transformer can move, in one table.
 *
 * This file exists because the alternative is the same eleven rules written out
 * four times — once in a form, once in an API route, once in an approval screen
 * and once in whatever gets built next — which is how a system ends up letting
 * a field engineer approve their own recovery on one screen and not another.
 *
 * The important decision here is what a movement is NOT. It is not a new
 * vocabulary for the chain. Seven of these eleven map onto lifecycle events that
 * already existed — a store-to-site movement IS a DISPATCHED event, not a
 * STORE_TO_SITE event sitting beside it. Adding parallel names would give
 * LIFECYCLE_RULES two rules that both move IN_STORE to IN_TRANSIT, and the story
 * page would show the same physical journey under two labels depending on which
 * screen recorded it. Only four movements genuinely had no event, and only those
 * four were added to the enum.
 *
 * A TransactionRecord is the envelope around a movement: who asked, who
 * authorised, which lorry, when it left, when it arrived. The chain stays the
 * letter.
 */

export type PlaceType = "MANUFACTURER" | "STORE" | "WORKSHOP" | "SITE" | "SCRAP";

export type Purpose = "INSTALL" | "REPAIR" | "TRANSFER" | "RETURN" | "REFURBISH" | "SCRAP";

export type MovementKey =
  | "MANUFACTURER_TO_STORE"
  | "STORE_TO_STORE"
  | "STORE_TO_SITE"
  | "STORE_TO_WORKSHOP"
  | "SITE_TO_WORKSHOP"
  | "SITE_TO_STORE"
  | "WORKSHOP_TO_STORE"
  | "WORKSHOP_TO_SITE"
  | "STORE_TO_MANUFACTURER"
  | "SITE_TO_SCRAP"
  | "WORKSHOP_TO_SCRAP";

export type Movement = {
  key: MovementKey;
  label: string;
  from: PlaceType;
  to: PlaceType;
  purpose: Purpose;
  /** Who may raise it. */
  initiators: Role[];
  /** Who may authorise it. Never the same person as the initiator — enforced in the API. */
  approvers: Role[];
  /**
   * The chain event written when the movement COMPLETES (on arrival), and the
   * statuses the transformer must be in for it to be legal. Both are checked
   * again by recordEvent against LIFECYCLE_RULES; these are here so a form can
   * offer only the movements that are actually possible for a given unit.
   */
  completionEvent: EventType;
  allowedFrom: TransformerStatus[];
  /** A physical journey needs a lorry and a driver. A scrapping in place does not. */
  requiresVehicle: boolean;
  /** One line explaining the movement, shown under the option in a form. */
  description: string;
};

/**
 * STORE_MANAGER now exists, and appears alongside MANAGER as an approver on
 * every movement. The narrowing is NOT expressed here — a store manager may
 * approve any KIND of movement, but only ones touching their own store, and
 * that is enforced per record in the API where the store is known. Encoding it
 * in this table would mean the table lying about a rule it cannot see.
 */
export const MOVEMENTS: Record<MovementKey, Movement> = {
  MANUFACTURER_TO_STORE: {
    key: "MANUFACTURER_TO_STORE",
    label: "Manufacturer → Store",
    from: "MANUFACTURER",
    to: "STORE",
    purpose: "TRANSFER",
    initiators: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "RECEIVED_AT_STORE",
    allowedFrom: ["IN_TRANSIT"],
    requiresVehicle: true,
    description:
      "A new delivery. Normally raised by the receive form, which already runs maker-checker on the unit itself.",
  },
  STORE_TO_STORE: {
    key: "STORE_TO_STORE",
    label: "Store → Store",
    from: "STORE",
    to: "STORE",
    purpose: "TRANSFER",
    initiators: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "TRANSFERRED_TO_STORE",
    allowedFrom: ["IN_STORE"],
    requiresVehicle: true,
    description: "Rebalancing stock between stores. The unit stays stock throughout.",
  },
  STORE_TO_SITE: {
    key: "STORE_TO_SITE",
    label: "Store → Site",
    from: "STORE",
    to: "SITE",
    purpose: "INSTALL",
    initiators: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "DISPATCHED",
    allowedFrom: ["IN_STORE"],
    requiresVehicle: true,
    description: "Dispatch for installation. Still refuses to leave without a passed intake test.",
  },
  STORE_TO_WORKSHOP: {
    key: "STORE_TO_WORKSHOP",
    label: "Store → Workshop",
    from: "STORE",
    to: "WORKSHOP",
    purpose: "REFURBISH",
    initiators: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "SENT_TO_WORKSHOP",
    allowedFrom: ["IN_STORE"],
    requiresVehicle: true,
    description: "Sent for testing or refurbishment. Not a fault — the unit never failed in service.",
  },
  SITE_TO_WORKSHOP: {
    key: "SITE_TO_WORKSHOP",
    label: "Site → Workshop",
    from: "SITE",
    to: "WORKSHOP",
    purpose: "REPAIR",
    initiators: ["FIELD_ENGINEER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "RECOVERED_FOR_REPAIR",
    allowedFrom: ["FAULTY", "IN_FIELD"],
    requiresVehicle: true,
    description: "Taken off the pole with the workshop as its destination.",
  },
  SITE_TO_STORE: {
    key: "SITE_TO_STORE",
    label: "Site → Store",
    from: "SITE",
    to: "STORE",
    purpose: "TRANSFER",
    initiators: ["FIELD_ENGINEER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "RECOVERED",
    allowedFrom: ["FAULTY", "IN_FIELD"],
    requiresVehicle: true,
    description: "Recovered but not faulty — a relocation, or a site that no longer needs it.",
  },
  WORKSHOP_TO_STORE: {
    key: "WORKSHOP_TO_STORE",
    label: "Workshop → Store",
    from: "WORKSHOP",
    to: "STORE",
    purpose: "RETURN",
    initiators: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "RECEIVED_AT_STORE",
    allowedFrom: ["REPAIRED"],
    requiresVehicle: true,
    description: "A repaired unit going back into stock. It must have passed its repair test first.",
  },
  WORKSHOP_TO_SITE: {
    key: "WORKSHOP_TO_SITE",
    label: "Workshop → Site",
    from: "WORKSHOP",
    to: "SITE",
    purpose: "INSTALL",
    initiators: ["FIELD_ENGINEER", "STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "DEPLOYED_FROM_WORKSHOP",
    allowedFrom: ["REPAIRED", "AT_WORKSHOP"],
    requiresVehicle: true,
    description: "Straight from the workshop to a pole, skipping the store.",
  },
  STORE_TO_MANUFACTURER: {
    key: "STORE_TO_MANUFACTURER",
    label: "Store → Manufacturer",
    from: "STORE",
    to: "MANUFACTURER",
    purpose: "RETURN",
    initiators: ["MANAGER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "RETURNED_TO_MANUFACTURER",
    allowedFrom: ["FAULTY", "IN_TRANSIT", "IN_STORE"],
    requiresVehicle: true,
    description:
      "A warranty return. A manager raises it and a manager approves it — so it must be a different manager, and the audit row says both names.",
  },
  SITE_TO_SCRAP: {
    key: "SITE_TO_SCRAP",
    label: "Site → Scrap",
    from: "SITE",
    to: "SCRAP",
    purpose: "SCRAP",
    initiators: ["FIELD_ENGINEER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "CONDEMNED_ON_SITE",
    allowedFrom: ["FAULTY", "IN_FIELD"],
    requiresVehicle: false,
    description: "Written off where it stands. Nothing is recovered, so no vehicle is recorded.",
  },
  WORKSHOP_TO_SCRAP: {
    key: "WORKSHOP_TO_SCRAP",
    label: "Workshop → Scrap",
    from: "WORKSHOP",
    to: "SCRAP",
    purpose: "SCRAP",
    initiators: ["STORE_KEEPER", "ADMIN"],
    approvers: ["MANAGER", "STORE_MANAGER", "ADMIN"],
    completionEvent: "DISPOSED",
    allowedFrom: ["BEYOND_REPAIR"],
    requiresVehicle: false,
    description: "Opened, condemned, and disposed of. Only possible once it is beyond repair.",
  },
};

/**
 * Why a given transformer can or cannot take part in a given movement.
 *
 * Returning a REASON rather than a boolean is the whole point. A form that
 * silently hides everything it cannot offer looks broken — the store keeper
 * knows the unit exists, sees an empty list, and concludes the system is wrong.
 * Every rejection here is a sentence somebody can act on.
 */
export type Eligibility = { ok: true } | { ok: false; reason: string };

export function checkEligibility(
  movement: Movement,
  unit: { status: TransformerStatus; heldByStoreId: string | null; heldByStoreName: string | null },
  actor: { role: Role; storeId: string | null },
): Eligibility {
  if (!movement.allowedFrom.includes(unit.status)) {
    return {
      ok: false,
      reason: `Is ${unit.status.toLowerCase().replace(/_/g, " ")} — a ${movement.label} movement starts from ${movement.allowedFrom
        .map((s) => s.toLowerCase().replace(/_/g, " "))
        .join(" or ")}.`,
    };
  }

  // Custody. An admin coordinates across the whole fleet; everybody else can
  // only move what they physically hold. A keeper at one store raising a
  // transfer for a unit sitting in another store is not a permission question,
  // it is a lie about who is loading the lorry.
  const originIsAPlace = movement.from === "STORE" || movement.from === "WORKSHOP";
  if (originIsAPlace && actor.role !== "ADMIN") {
    if (!actor.storeId) {
      return { ok: false, reason: "You are not assigned to a store, so you hold nothing to move." };
    }
    if (unit.heldByStoreId !== actor.storeId) {
      return {
        ok: false,
        reason: unit.heldByStoreName
          ? `Held at ${unit.heldByStoreName}, not yours. That store raises the transfer.`
          : "Not held at any store, so there is nothing for you to load.",
      };
    }
  }

  return { ok: true };
}

export const MOVEMENT_KEYS = Object.keys(MOVEMENTS) as MovementKey[];

/** Movements this role is allowed to raise. */
export function movementsFor(role: Role): Movement[] {
  return MOVEMENT_KEYS.map((k) => MOVEMENTS[k]).filter((m) => m.initiators.includes(role));
}

/** Movements legal for a transformer in this status, filtered to what the role may raise. */
export function movementsAvailable(role: Role, status: TransformerStatus): Movement[] {
  return movementsFor(role).filter((m) => m.allowedFrom.includes(status));
}

export function canApprove(movement: Movement, role: Role): boolean {
  return movement.approvers.includes(role);
}

export const TRANSACTION_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "IN_TRANSIT",
  "COMPLETED",
  "REJECTED",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_STATUS_META: Record<
  TransactionStatus,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "info" },
  IN_TRANSIT: { label: "In transit", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

/** "T-2026-0042". Sequence is supplied by the caller, which counts the day's batches. */
export function formatBatchRef(year: number, sequence: number): string {
  return `T-${year}-${String(sequence).padStart(4, "0")}`;
}

export function describeMovement(fromName: string, toName: string): string {
  return `${fromName} → ${toName}`;
}
