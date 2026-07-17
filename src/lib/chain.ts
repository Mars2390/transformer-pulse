import { createHash } from "node:crypto";

/**
 * The tamper-evident custody chain.
 *
 * Every lifecycle event stores `hash = sha256(prevHash + its own contents)`.
 * Because each hash folds in the previous one, editing an old row invalidates
 * every hash after it.
 *
 * Be precise about what this does and does not do — you will be asked:
 *
 *   It does NOT stop a database administrator from rewriting history.
 *   It makes it impossible to rewrite history WITHOUT LEAVING EVIDENCE.
 *
 * That distinction is the whole point. It turns "our records say" into
 * something a manufacturer's lawyer cannot simply wave away.
 */

export const GENESIS_HASH = "0".repeat(64);

export type ChainPayload = {
  transformerId: string;
  type: string;
  toStatus: string;
  userId: string;
  occurredAt: Date | string;
  lat?: number | null;
  lng?: number | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  notes?: string | null;
};

/**
 * Serialises an event deterministically.
 *
 * JSON.stringify over a FIXED-ORDER array — not an object, whose key order is
 * not guaranteed across engines, and not string concatenation, where a comma
 * typed into `notes` could shift a field boundary and forge a different event
 * with the same hash.
 */
function canonicalise(payload: ChainPayload): string {
  const occurredAt =
    payload.occurredAt instanceof Date
      ? payload.occurredAt.toISOString()
      : new Date(payload.occurredAt).toISOString();

  return JSON.stringify([
    payload.transformerId,
    payload.type,
    payload.toStatus,
    payload.userId,
    occurredAt,
    payload.lat ?? null,
    payload.lng ?? null,
    payload.vehiclePlate ?? null,
    payload.driverName ?? null,
    payload.notes ?? null,
  ]);
}

export function computeEventHash(
  prevHash: string | null,
  payload: ChainPayload,
): string {
  return createHash("sha256")
    .update(prevHash ?? GENESIS_HASH)
    .update(canonicalise(payload))
    .digest("hex");
}

export type ChainLink = {
  id: string;
  hash: string;
  prevHash: string | null;
  transformerId: string;
  type: string;
  toStatus: string;
  userId: string;
  occurredAt: Date;
  lat: number | null;
  lng: number | null;
  vehiclePlate: string | null;
  driverName: string | null;
  notes: string | null;
};

export type ChainVerification = {
  valid: boolean;
  checked: number;
  brokenAtEventId: string | null;
  reason: string | null;
};

/**
 * Walks a transformer's events oldest-first and recomputes every hash.
 * Powers the "verified" badge on the story page.
 */
export function verifyChain(events: ChainLink[]): ChainVerification {
  let expectedPrev: string | null = null;

  for (const event of events) {
    if ((event.prevHash ?? null) !== expectedPrev) {
      return {
        valid: false,
        checked: events.length,
        brokenAtEventId: event.id,
        reason:
          "An event is missing, or this event does not link to the one before it.",
      };
    }

    if (computeEventHash(event.prevHash, event) !== event.hash) {
      return {
        valid: false,
        checked: events.length,
        brokenAtEventId: event.id,
        reason: "This event's contents do not match its recorded hash.",
      };
    }

    expectedPrev = event.hash;
  }

  return {
    valid: true,
    checked: events.length,
    brokenAtEventId: null,
    reason: null,
  };
}
