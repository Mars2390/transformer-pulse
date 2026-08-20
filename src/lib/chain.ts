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
 * Verifies a transformer's history by walking the chain in the order it was
 * built, and recomputing every hash. Powers the "verified" badge on the story
 * page.
 *
 * ---------------------------------------------------------------------------
 * Why the order is derived here and not taken from the caller
 * ---------------------------------------------------------------------------
 * This used to walk the array exactly as handed to it, and every caller sorted
 * by `occurredAt`. That is the order events are said to have HAPPENED, which is
 * not the order they were LINKED — and the chain links by insertion.
 *
 * The two orders come apart the moment an event is backdated, which happens
 * routinely and legitimately: a load check carries the timestamp of the last
 * reading in the file, so uploading March telemetry in June puts a March event
 * on the end of a chain whose previous event is dated June. Sorted by
 * occurredAt, that event jumps to the front, its prevHash no longer matches the
 * event now preceding it, and a perfectly intact history is reported as broken.
 * On this register that misreported 32 transformers — every one of them with
 * hashes that verify perfectly once walked in the right order.
 *
 * A false "BROKEN" is not a harmless bug in a tamper-evident log. It is the
 * failure mode that matters most, because it teaches people that the badge does
 * not mean anything.
 *
 * So the chain now says what its own order is. Each event names its predecessor
 * by hash, which is a stronger statement than any timestamp, and following that
 * makes the result independent of how the caller happened to sort. It also
 * detects two things the old walk could not: a fork, where two events claim the
 * same predecessor, and a duplicated hash.
 *
 * Tamper detection is not weakened by this. prevHash is an input to each
 * event's own hash, so an altered link fails the recomputation just as an
 * altered field does.
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

  const broken = (event: ChainLink | null, reason: string): ChainVerification => ({
    valid: false,
    checked: events.length,
    brokenAtEventId: event?.id ?? null,
    reason,
  });

  const MISSING_LINK = "An event is missing, or this event does not link to the one before it.";

  // The event a broken chain should point the reader at: the first one, in the
  // order they were given, whose predecessor is not here. That is the edge of
  // the hole, and it is what a person looking for the missing row needs.
  const firstOrphan = (pool: readonly ChainLink[], present: ReadonlySet<string>) =>
    pool.find((e) => e.prevHash != null && !present.has(e.prevHash)) ?? pool[0] ?? null;

  const byHash = new Map<string, ChainLink>();
  for (const event of events) {
    if (byHash.has(event.hash)) {
      return broken(event, "Two events carry the same hash. One of them is not genuine.");
    }
    byHash.set(event.hash, event);
  }

  const successors = new Map<string, ChainLink[]>();
  for (const event of events) {
    if (event.prevHash == null) continue;
    const list = successors.get(event.prevHash) ?? [];
    list.push(event);
    successors.set(event.prevHash, list);
  }

  const roots = events.filter((e) => e.prevHash == null);
  if (roots.length === 0) {
    // Nothing claims to be the beginning, so the genesis event is gone.
    return broken(firstOrphan(events, new Set(byHash.keys())), MISSING_LINK);
  }
  if (roots.length > 1) {
    return broken(roots[1], "This history has more than one starting point. Only one is genuine.");
  }

  const ordered: ChainLink[] = [];
  const visited = new Set<string>();
  let current: ChainLink | undefined = roots[0];
  while (current) {
    if (visited.has(current.id)) {
      return broken(current, "This history loops back on itself and cannot be a chain.");
    }
    visited.add(current.id);
    ordered.push(current);

    const next: ChainLink[] = successors.get(current.hash) ?? [];
    if (next.length > 1) {
      return broken(next[1], "Two events claim to follow the same event. The history has been forked.");
    }
    current = next[0];
  }

  if (ordered.length !== events.length) {
    // Rows that are here but hang off nothing the chain can reach.
    const stranded = events.filter((e) => !visited.has(e.id));
    return broken(firstOrphan(stranded, new Set(byHash.keys())), MISSING_LINK);
  }

  for (const event of ordered) {
    if (computeEventHash(event.prevHash, event, event.hashVersion) !== event.hash) {
      return broken(event, "This event's contents do not match its recorded hash.");
    }
  }

  return {
    valid: true,
    checked: events.length,
    brokenAtEventId: null,
    reason: null,
  };
}
