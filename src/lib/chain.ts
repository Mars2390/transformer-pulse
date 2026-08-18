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
  fromStatus?: string | null;
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
/**
 * The canonical form is VERSIONED, and v1 must never be edited.
 *
 * fromStatus belongs in the hash — leaving it out meant the field a movement is
 * defined by could be rewritten without breaking anything, which is a hole in
 * the one guarantee this file makes. But changing the array in place would
 * recompute every hash already written and fail verification on the entire
 * history, turning a correctness fix into a system-wide "tampered" alarm on data
 * nobody touched.
 *
 * So v1 is frozen exactly as it was, v2 adds fromStatus, every row records which
 * one produced it, and verification asks the row. Old events verify as they
 * always did; new events cover the extra field. This is the only safe way to
 * change a hash format over data you have already signed.
 */
export const CURRENT_HASH_VERSION = 2;

function canonicalise(payload: ChainPayload, version: number): string {
  const occurredAt =
    payload.occurredAt instanceof Date
      ? payload.occurredAt.toISOString()
      : new Date(payload.occurredAt).toISOString();

  const v1 = [
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
  ];

  // v1 is frozen. v2 appends fromStatus after the last v1 element, so a v1 row
  // still serialises byte-for-byte as it did the day it was written.
  if (version === 1) return JSON.stringify(v1);
  return JSON.stringify([...v1, payload.fromStatus ?? null]);
}

export function computeEventHash(
  prevHash: string | null,
  payload: ChainPayload,
  version: number = CURRENT_HASH_VERSION,
): string {
  return createHash("sha256")
    .update(prevHash ?? GENESIS_HASH)
    .update(canonicalise(payload, version))
    .digest("hex");
}

export type ChainLink = {
  id: string;
  hash: string;
  prevHash: string | null;
  transformerId: string;
  type: string;
  fromStatus: string | null;
  toStatus: string;
  userId: string;
  occurredAt: Date;
  lat: number | null;
  lng: number | null;
  vehiclePlate: string | null;
  driverName: string | null;
  notes: string | null;
  hashVersion: number;
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
  // An empty chain is not a verified chain.
  //
  // Returning valid:true for zero events meant a transformer whose entire
  // history had been deleted displayed the same green badge as one whose history
  // was intact — the single outcome the chain exists to make visible. Every
  // transformer is created with a genesis event, so no events means rows are
  // gone, and that is the loudest thing this function can be asked to report.
  if (events.length === 0) {
    return {
      valid: false,
      checked: 0,
      brokenAtEventId: null,
      reason: "This transformer has no history at all. Its events are missing.",
    };
  }

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

    if (computeEventHash(event.prevHash, event, event.hashVersion) !== event.hash) {
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
