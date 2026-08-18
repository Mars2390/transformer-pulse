import { describe, expect, it } from "vitest";

import {
  CURRENT_HASH_VERSION,
  computeEventHash,
  verifyChain,
  type ChainLink,
  type ChainPayload,
} from "./chain";

/**
 * The v1 regression fixture, and the reason this file exists.
 *
 * FROZEN_V1_HASH was computed with the ten-element canonical form: the one every
 * hash already written to the database used. It is hard-coded on purpose. If
 * canonicalise(v1) is ever edited — a field reordered, added, or spelt
 * differently — this assertion fails here, at the cost of one red test, instead
 * of failing in production as every verified badge in the register turns red on
 * data nobody touched.
 *
 * Do not regenerate this constant to make the test pass. A change that breaks it
 * is a change that breaks history.
 */
const FROZEN_V1_HASH =
  "a73e5dd5b22715453e9d434cecd2a989e71192f2e57d93d28ff561bd2c69fc22";

const OCCURRED_AT = new Date("2025-01-15T09:00:00.000Z");

/** The event the fixture above was computed from. */
const BASE: Omit<ChainLink, "id" | "hash" | "prevHash" | "hashVersion"> = {
  transformerId: "tx-001",
  type: "RECEIVED_AT_STORE",
  fromStatus: "IN_TRANSIT",
  toStatus: "IN_STORE",
  userId: "user-001",
  occurredAt: OCCURRED_AT,
  lat: null,
  lng: null,
  vehiclePlate: null,
  driverName: null,
  notes: "Received, checked, racked",
};

/** A correctly signed link, so a broken one has to be broken deliberately. */
function signed(
  prevHash: string | null,
  id: string,
  hashVersion: number = CURRENT_HASH_VERSION,
  over: Partial<ChainLink> = {},
): ChainLink {
  const unsigned = { ...BASE, ...over, id, prevHash, hashVersion, hash: "" };
  return { ...unsigned, hash: computeEventHash(prevHash, unsigned, hashVersion) };
}

/** Three links that genuinely chain, at the versions asked for. */
function chainOf(...versions: number[]): ChainLink[] {
  const links: ChainLink[] = [];
  let prevHash: string | null = null;
  versions.forEach((version, i) => {
    const link = signed(prevHash, `e${i + 1}`, version, { notes: `step ${i + 1}` });
    links.push(link);
    prevHash = link.hash;
  });
  return links;
}

describe("computeEventHash", () => {
  it("recomputes a v1 hash exactly as it was written", () => {
    expect(computeEventHash(null, BASE as ChainPayload, 1)).toBe(FROZEN_V1_HASH);
  });

  it("leaves fromStatus out of v1, so old rows are unaffected by the new field", () => {
    const rewritten = { ...BASE, fromStatus: "UNDER_REPAIR" } as ChainPayload;
    expect(computeEventHash(null, rewritten, 1)).toBe(FROZEN_V1_HASH);
  });

  it("covers fromStatus in v2, which is the whole point of v2", () => {
    const original = computeEventHash(null, BASE as ChainPayload, 2);
    const rewritten = computeEventHash(
      null,
      { ...BASE, fromStatus: "UNDER_REPAIR" } as ChainPayload,
      2,
    );
    expect(rewritten).not.toBe(original);
  });

  it("defaults to the current version", () => {
    expect(CURRENT_HASH_VERSION).toBe(2);
    expect(computeEventHash(null, BASE as ChainPayload)).toBe(
      computeEventHash(null, BASE as ChainPayload, CURRENT_HASH_VERSION),
    );
  });

  it("gives v1 and v2 different hashes for the same event", () => {
    expect(computeEventHash(null, BASE as ChainPayload, 2)).not.toBe(FROZEN_V1_HASH);
  });

  it("breaks when the notes are edited", () => {
    const edited = { ...BASE, notes: "Received, checked, racked." } as ChainPayload;
    expect(computeEventHash(null, edited, 2)).not.toBe(
      computeEventHash(null, BASE as ChainPayload, 2),
    );
  });

  it("cannot be forged by moving a comma across a field boundary", () => {
    // Two genuinely different events that a naive join(",") would hash alike.
    const a = { ...BASE, driverName: "Otieno", notes: "late" } as ChainPayload;
    const b = { ...BASE, driverName: "Otieno,late", notes: null } as ChainPayload;
    expect(computeEventHash(null, a, 2)).not.toBe(computeEventHash(null, b, 2));
  });
});

describe("verifyChain", () => {
  it("refuses an empty chain instead of calling it verified", () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.reason).toMatch(/no history/i);
  });

  it("verifies an intact chain", () => {
    const result = verifyChain(chainOf(2, 2, 2));
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.brokenAtEventId).toBeNull();
  });

  it("verifies a chain that mixes v1 and v2 rows, because it asks each row", () => {
    expect(verifyChain(chainOf(1, 1, 2)).valid).toBe(true);
  });

  it("reports the FIRST broken event, not the last", () => {
    const events = chainOf(2, 2, 2);
    // Edit the middle event without re-signing it. The link from e3 to e2 still
    // holds, so a checker that only looked at links would miss this.
    events[1] = { ...events[1], notes: "quietly rewritten" };
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtEventId).toBe("e2");
    expect(result.brokenAtEventId).not.toBe("e3");
  });

  it("notices a deleted event by the broken link", () => {
    const events = chainOf(2, 2, 2);
    const result = verifyChain(events.slice(1));
    expect(result.valid).toBe(false);
    expect(result.brokenAtEventId).toBe("e2");
    expect(result.reason).toMatch(/missing|link/i);
  });

  it("notices an edited fromStatus on a v2 row", () => {
    const events = chainOf(2);
    events[0] = { ...events[0], fromStatus: "DECOMMISSIONED" };
    expect(verifyChain(events).valid).toBe(false);
  });

  it("does not notice an edited fromStatus on a v1 row, which is why v2 exists", () => {
    const events = chainOf(1);
    events[0] = { ...events[0], fromStatus: "DECOMMISSIONED" };
    expect(verifyChain(events).valid).toBe(true);
  });
});
