import { describe, expect, it } from "vitest";
import {
  blockContentHash, findDuplicates, worstVerdict, importDecision, identityKey,
  type FingerprintRow, type CandidateRange, type ExistingRange,
} from "./emdis-fingerprint";

/**
 * The duplicate rules, tested where they can be tested: on arithmetic, with no
 * database in sight.
 *
 * These are the rules that decide whether a real upload is refused, so each
 * test below is a claim about a way the system could get that wrong — a float
 * that round-tripped through Excel, rows arriving in a different order, an
 * unmatched block being compared against a matched one — rather than a
 * restatement of what the code says.
 */

const T = (iso: string) => new Date(iso);

function row(t: string, over: Partial<FingerprintRow> = {}): FingerprintRow {
  return {
    recordedAt: T(t),
    l1nV: 240, l2nV: 241, l3nV: 239,
    l1c: 100, l2c: 110, l3c: 90, neutralC: 12,
    l1l2V: 415, l2l3V: 416, l3l1V: 414,
    kva: 70, kw: 66, kvar: 20, pf: 0.94, hz: 50, thdPct: 3.2, kwh: 12345,
    ...over,
  };
}

const ROWS = [row("2026-01-01T00:00:00Z"), row("2026-01-01T00:01:00Z"), row("2026-01-01T00:02:00Z")];

describe("blockContentHash", () => {
  it("is unchanged by the order the rows arrive in", () => {
    const forward = blockContentHash("0322", "SN-1", ROWS);
    const shuffled = blockContentHash("0322", "SN-1", [ROWS[2], ROWS[0], ROWS[1]]);
    expect(shuffled).toBe(forward);
  });

  it("survives the float noise a spreadsheet round trip introduces", () => {
    // 231.3 read back out of XLSX as 231.29999999999998 is the same reading.
    // If this fails, re-uploading an identical file reads as new data.
    const clean = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { l1c: 231.3 })]);
    const noisy = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { l1c: 231.29999999999998 })]);
    expect(noisy).toBe(clean);
  });

  it("changes when a measurement genuinely changes", () => {
    const a = blockContentHash("0322", "SN-1", ROWS);
    const b = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { l1c: 101 }), ROWS[1], ROWS[2]]);
    expect(b).not.toBe(a);
  });

  it("distinguishes a missing reading from a zero one", () => {
    // A meter that reported nothing and a meter that reported 0 A are different
    // facts, and collapsing them would let a corrected export pass as identical.
    const missing = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { neutralC: null })]);
    const zero = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { neutralC: 0 })]);
    expect(missing).not.toBe(zero);
  });

  it("separates two transformers that recorded the same numbers", () => {
    const a = blockContentHash("0322", "SN-1", ROWS);
    const b = blockContentHash("0348", "SN-2", ROWS);
    expect(b).not.toBe(a);
  });

  it("treats identity as case- and whitespace-insensitive", () => {
    expect(identityKey(" 0322 ", "sn 1")).toBe(identityKey("0322", "SN1"));
    expect(blockContentHash(" 0322 ", "sn 1", ROWS)).toBe(blockContentHash("0322", "SN1", ROWS));
  });

  it("does not collide on timestamps alone when values differ", () => {
    const a = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { kva: 70 })]);
    const b = blockContentHash("0322", "SN-1", [row("2026-01-01T00:00:00Z", { kva: 71 })]);
    expect(a).not.toBe(b);
  });
});

function candidate(over: Partial<CandidateRange> = {}): CandidateRange {
  return {
    contentHash: "hash-new",
    transformerId: "tx-1",
    identity: "0322|SN1",
    firstReadingAt: T("2026-06-01T00:00:00Z"),
    lastReadingAt: T("2026-06-03T00:00:00Z"),
    readingCount: 2880,
    ...over,
  };
}

function existing(over: Partial<ExistingRange> = {}): ExistingRange {
  return {
    ...candidate(),
    contentHash: "hash-old",
    id: "ds-1",
    name: "earlier.xlsx",
    createdAt: T("2026-05-01T00:00:00Z"),
    ...over,
  };
}

describe("findDuplicates", () => {
  it("finds nothing when the register is empty", () => {
    expect(findDuplicates(candidate(), [])).toEqual([]);
  });

  it("calls an identical fingerprint IDENTICAL", () => {
    const found = findDuplicates(candidate({ contentHash: "same" }), [existing({ contentHash: "same" })]);
    expect(found).toHaveLength(1);
    expect(found[0].verdict).toBe("IDENTICAL");
  });

  it("catches an identical fingerprint even when only one side is matched", () => {
    // The same file uploaded before and after the transformer was registered.
    // Comparing by identity alone would call these two different units.
    const found = findDuplicates(
      candidate({ contentHash: "same", transformerId: "tx-1" }),
      [existing({ contentHash: "same", transformerId: null })],
    );
    expect(found[0]?.verdict).toBe("IDENTICAL");
  });

  it("calls the same window on the same unit SAME_RANGE", () => {
    const found = findDuplicates(candidate(), [existing()]);
    expect(found).toHaveLength(1);
    expect(found[0].verdict).toBe("SAME_RANGE");
    expect(found[0].overlapPct).toBe(100);
  });

  it("calls a partial intersection OVERLAP and quotes how much", () => {
    // Incoming covers Jun 1-3; stored covers Jun 2-4. Half the incoming window
    // is already held.
    const found = findDuplicates(candidate(), [
      existing({
        firstReadingAt: T("2026-06-02T00:00:00Z"),
        lastReadingAt: T("2026-06-04T00:00:00Z"),
      }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].verdict).toBe("OVERLAP");
    expect(found[0].overlapPct).toBeCloseTo(50, 5);
  });

  it("leaves adjacent windows alone", () => {
    // Ends exactly where the stored one begins: touching, not overlapping.
    const found = findDuplicates(candidate(), [
      existing({
        firstReadingAt: T("2026-06-03T00:00:00Z"),
        lastReadingAt: T("2026-06-05T00:00:00Z"),
      }),
    ]);
    expect(found).toEqual([]);
  });

  it("does not compare two different transformers", () => {
    const found = findDuplicates(candidate(), [existing({ transformerId: "tx-2" })]);
    expect(found).toEqual([]);
  });

  it("does not compare an unmatched block against a matched one", () => {
    // "No transformer" is not an identity two blocks can be said to share.
    const found = findDuplicates(
      candidate({ transformerId: null }),
      [existing({ transformerId: "tx-1" })],
    );
    expect(found).toEqual([]);
  });

  it("compares two unmatched blocks by what their files claim", () => {
    const found = findDuplicates(
      candidate({ transformerId: null }),
      [existing({ transformerId: null })],
    );
    expect(found[0]?.verdict).toBe("SAME_RANGE");
  });

  it("does not treat two blocks with no identity at all as the same unit", () => {
    const found = findDuplicates(
      candidate({ transformerId: null, identity: "|" }),
      [existing({ transformerId: null, identity: "|" })],
    );
    expect(found).toEqual([]);
  });

  it("reports every finding, worst first", () => {
    const found = findDuplicates(candidate({ contentHash: "same" }), [
      existing({
        id: "ds-overlap",
        firstReadingAt: T("2026-06-02T00:00:00Z"),
        lastReadingAt: T("2026-06-04T00:00:00Z"),
      }),
      existing({ id: "ds-identical", contentHash: "same" }),
    ]);
    expect(found.map((f) => f.verdict)).toEqual(["IDENTICAL", "OVERLAP"]);
  });

  it("ignores an empty fingerprint rather than matching everything to it", () => {
    // Datasets imported before fingerprinting existed carry "". If empty were
    // allowed to match empty, the first scan would call them all duplicates of
    // each other and invite someone to delete real load history.
    const found = findDuplicates(
      candidate({ contentHash: "", transformerId: "tx-9" }),
      [existing({ contentHash: "", transformerId: "tx-8" })],
    );
    expect(found).toEqual([]);
  });
});

describe("worstVerdict", () => {
  it("is CLEAR with no findings", () => {
    expect(worstVerdict([])).toBe("CLEAR");
  });

  it("lets IDENTICAL outrank a same-range finding", () => {
    const found = findDuplicates(candidate({ contentHash: "same" }), [
      existing({ id: "a" }),
      existing({ id: "b", contentHash: "same" }),
    ]);
    expect(worstVerdict(found)).toBe("IDENTICAL");
  });

  it("lets SAME_RANGE outrank an overlap", () => {
    const found = findDuplicates(candidate(), [
      existing({
        id: "a",
        firstReadingAt: T("2026-06-02T00:00:00Z"),
        lastReadingAt: T("2026-06-04T00:00:00Z"),
      }),
      existing({ id: "b" }),
    ]);
    expect(worstVerdict(found)).toBe("SAME_RANGE");
  });
});

describe("importDecision", () => {
  it("refuses an exact duplicate and offers no way around it", () => {
    // The one rule the whole feature rests on. If this ever becomes
    // overridable, every sum taken over the hourly rollup is at risk again.
    expect(importDecision("IDENTICAL")).toEqual({ blocked: true, overridable: false });
  });

  it("blocks a same-window re-export but lets a human overrule it", () => {
    expect(importDecision("SAME_RANGE")).toEqual({ blocked: true, overridable: true });
  });

  it("warns on an overlap without blocking it", () => {
    expect(importDecision("OVERLAP")).toEqual({ blocked: false, overridable: true });
  });

  it("waves clear data through", () => {
    expect(importDecision("CLEAR")).toEqual({ blocked: false, overridable: false });
  });
});
