import { createHash } from "node:crypto";

/**
 * Telling one upload from the same upload arriving twice.
 *
 * This is the arithmetic half of duplicate detection — no database, no Prisma,
 * no I/O — so it can be reasoned about and tested on its own. The database half
 * lives in emdis-duplicates.ts and does nothing but ask these functions.
 *
 * ---------------------------------------------------------------------------
 * Why a duplicate is not a cosmetic problem
 * ---------------------------------------------------------------------------
 * Most of the analysis is built from maxima, and a maximum does not care how
 * many times it is told the same thing: max(x, x) is x. That is what makes
 * duplication invisible almost everywhere, and it is exactly what makes it
 * dangerous — it looks harmless right up until it is read.
 *
 * The figures that DO change are the ones that add up:
 *
 *   minutesOver100Pct / minutesOver80Pct   summed across the hourly rollup in
 *                                          combined-health, and the whole point
 *                                          of them is that five minutes over
 *                                          rated and six hours over rated are
 *                                          different problems. Import the same
 *                                          day twice and a transformer is
 *                                          reported as having spent twice as
 *                                          long in overload as it did.
 *
 *   readingCount                           summed on the transformer page and
 *                                          in the dossier PDF — "12,000 load
 *                                          readings" for 6,000 measurements.
 *
 *   Alert rows                             one per condition per upload, so the
 *                                          same defect is raised twice and the
 *                                          alert list stops being a list of
 *                                          problems.
 *
 * So the rule is not "duplicates are untidy". It is that a duplicate makes the
 * system state something about a real transformer that is not true.
 */

/** A row as it comes out of the parser, before anything is derived from it. */
export type FingerprintRow = {
  recordedAt: Date;
  l1nV: number | null; l2nV: number | null; l3nV: number | null;
  l1c: number | null; l2c: number | null; l3c: number | null;
  neutralC: number | null;
  l1l2V: number | null; l2l3V: number | null; l3l1V: number | null;
  kva: number | null; kw: number | null; kvar: number | null;
  pf: number | null; hz: number | null; thdPct: number | null; kwh: number | null;
};

/**
 * The channels that go into the hash, in a fixed order.
 *
 * Fixed and explicit rather than Object.keys(), because key order is a property
 * of how an object happened to be built. Two parsers producing the same numbers
 * in a different insertion order would then produce different hashes, and the
 * duplicate check would quietly stop working with no test failing.
 */
const CHANNELS = [
  "l1nV", "l2nV", "l3nV",
  "l1c", "l2c", "l3c", "neutralC",
  "l1l2V", "l2l3V", "l3l1V",
  "kva", "kw", "kvar", "pf", "hz", "thdPct", "kwh",
] as const;

/**
 * One number, rendered so that equal values always render equally.
 *
 * Rounded to three decimals before printing. A float that survives a round trip
 * through XLSX and back can come out as 231.29999999999998 where it went in as
 * 231.3, and a hash that treated those as different readings would report a
 * re-upload of the identical file as new data — the exact failure this function
 * exists to prevent. Three decimals is far finer than any meter's resolution.
 */
function chan(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/**
 * Identity as the file states it, normalised.
 *
 * Included in the hash so that two transformers cannot collide, but deliberately
 * WITHOUT make or rating: those are header fields a human may correct between
 * one upload and the next, and correcting a typo in the rating does not make the
 * readings underneath it different readings.
 */
export function identityKey(substationCode: string | null, serial: string | null): string {
  const sub = (substationCode ?? "").trim().toUpperCase();
  const ser = (serial ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return `${sub}|${ser}`;
}

/**
 * A stable fingerprint of what a block actually measured.
 *
 * Rows are sorted by time first, so a file whose rows arrive in a different
 * order — which XLSX readers do not guarantee — still fingerprints the same.
 * Fed to the hash in chunks rather than joined into one string, because a year
 * of one-minute data is half a million rows and building a single 40 MB string
 * to hash it would be a needless spike.
 */
export function blockContentHash(
  substationCode: string | null,
  serial: string | null,
  rows: readonly FingerprintRow[],
): string {
  const h = createHash("sha256");
  h.update(identityKey(substationCode, serial));
  h.update(" ");

  const sorted = [...rows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  let buf = "";
  for (const r of sorted) {
    buf += r.recordedAt.toISOString();
    for (const c of CHANNELS) buf += "," + chan(r[c]);
    buf += "\n";
    if (buf.length > 1 << 16) { h.update(buf); buf = ""; }
  }
  if (buf) h.update(buf);

  return h.digest("hex");
}

/** What the incoming block claims about itself, for comparison against the register. */
export type CandidateRange = {
  contentHash: string;
  /** The matched transformer, when the block has one. */
  transformerId: string | null;
  /** Falls back to file-stated identity when there is no register match. */
  identity: string;
  firstReadingAt: Date;
  lastReadingAt: Date;
  readingCount: number;
};

/** An already-stored dataset, in the same shape. */
export type ExistingRange = CandidateRange & { id: string; name: string; createdAt: Date };

export type DuplicateVerdict =
  /** The same readings. Not a judgement call, and not overridable. */
  | "IDENTICAL"
  /** Same unit, same window, different numbers — a re-export or a correction. */
  | "SAME_RANGE"
  /** Same unit, intersecting windows. May be legitimate; a human decides. */
  | "OVERLAP"
  | "CLEAR";

export type DuplicateFinding = {
  verdict: Exclude<DuplicateVerdict, "CLEAR">;
  against: ExistingRange;
  /** How much of the incoming window is already covered, 0-100. */
  overlapPct: number;
  /** Plain sentence naming what was found, shown to whoever has to decide. */
  reason: string;
};

/** Milliseconds of intersection between two closed intervals. */
function intersectionMs(a: CandidateRange, b: ExistingRange): number {
  const start = Math.max(a.firstReadingAt.getTime(), b.firstReadingAt.getTime());
  const end = Math.min(a.lastReadingAt.getTime(), b.lastReadingAt.getTime());
  return Math.max(0, end - start);
}

/**
 * Do these two describe the same physical unit?
 *
 * Matched datasets are compared by transformer id, which is the only identity
 * the register guarantees. Unmatched ones fall back to what the file said about
 * itself — and two unmatched blocks are only ever compared to each other, never
 * to a matched one, because "no transformer" is not an identity two blocks can
 * be said to share.
 */
function sameUnit(a: CandidateRange, b: ExistingRange): boolean {
  if (a.transformerId && b.transformerId) return a.transformerId === b.transformerId;
  if (a.transformerId || b.transformerId) return false;
  return a.identity !== "|" && a.identity === b.identity;
}

/**
 * Compare one incoming block against everything already stored.
 *
 * Returns every finding, worst first, rather than the first hit: an upload that
 * overlaps three stored datasets is a different situation from one that overlaps
 * one, and the person deciding should be shown all of it.
 */
export function findDuplicates(
  candidate: CandidateRange,
  existing: readonly ExistingRange[],
): DuplicateFinding[] {
  const out: DuplicateFinding[] = [];

  for (const e of existing) {
    // An identical fingerprint is conclusive on its own. It does not need the
    // identity check, and must not be gated behind one: the same readings
    // uploaded before and after a transformer was matched to the register would
    // otherwise compare as two different units and both be kept.
    if (candidate.contentHash && candidate.contentHash === e.contentHash) {
      out.push({
        verdict: "IDENTICAL",
        against: e,
        overlapPct: 100,
        reason:
          `Byte-for-byte the same readings as "${e.name}" — the same ${e.readingCount.toLocaleString()} ` +
          `measurements over the same window. Importing it again would double every total taken over it.`,
      });
      continue;
    }

    if (!sameUnit(candidate, e)) continue;

    const sameStart = candidate.firstReadingAt.getTime() === e.firstReadingAt.getTime();
    const sameEnd = candidate.lastReadingAt.getTime() === e.lastReadingAt.getTime();

    if (sameStart && sameEnd) {
      out.push({
        verdict: "SAME_RANGE",
        against: e,
        overlapPct: 100,
        reason:
          `"${e.name}" already covers this transformer over exactly this window ` +
          `(${fmtRange(e.firstReadingAt, e.lastReadingAt)}), with ` +
          `${e.readingCount.toLocaleString()} readings against this file's ${candidate.readingCount.toLocaleString()}. ` +
          `The measurements differ, so one of the two is a corrected re-export.`,
      });
      continue;
    }

    const ms = intersectionMs(candidate, e);
    if (ms > 0) {
      const span = Math.max(1, candidate.lastReadingAt.getTime() - candidate.firstReadingAt.getTime());
      const pct = Math.min(100, (ms / span) * 100);
      out.push({
        verdict: "OVERLAP",
        against: e,
        overlapPct: pct,
        reason:
          `${pct.toFixed(0)}% of this file's window is already covered by "${e.name}" ` +
          `(${fmtRange(e.firstReadingAt, e.lastReadingAt)}). Overlapping readings are counted twice ` +
          `in time-over-rated totals.`,
      });
    }
  }

  const rank: Record<Exclude<DuplicateVerdict, "CLEAR">, number> = {
    IDENTICAL: 0, SAME_RANGE: 1, OVERLAP: 2,
  };
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.overlapPct - a.overlapPct);
}

/**
 * The single verdict for a block, from all its findings.
 *
 * IDENTICAL outranks everything, then SAME_RANGE, then OVERLAP — the worst
 * finding is the one that decides, because a file that is an exact copy of one
 * dataset and a partial overlap of another is an exact copy.
 */
export function worstVerdict(findings: readonly DuplicateFinding[]): DuplicateVerdict {
  if (findings.some((f) => f.verdict === "IDENTICAL")) return "IDENTICAL";
  if (findings.some((f) => f.verdict === "SAME_RANGE")) return "SAME_RANGE";
  if (findings.length) return "OVERLAP";
  return "CLEAR";
}

/**
 * May this block be imported, and does that need an explicit human override?
 *
 * IDENTICAL is refused outright and no flag unlocks it. There is no reading of
 * "import these exact same numbers a second time" that produces a truer picture
 * of the transformer, and leaving a door open for it is how the totals rot.
 * The other two are genuine judgement calls and belong to the person uploading.
 */
export function importDecision(verdict: DuplicateVerdict): {
  blocked: boolean;
  overridable: boolean;
} {
  switch (verdict) {
    case "IDENTICAL": return { blocked: true, overridable: false };
    case "SAME_RANGE": return { blocked: true, overridable: true };
    case "OVERLAP": return { blocked: false, overridable: true };
    case "CLEAR": return { blocked: false, overridable: false };
  }
}

function fmtRange(a: Date, b: Date): string {
  const d = (x: Date) => x.toISOString().slice(0, 16).replace("T", " ");
  return `${d(a)} to ${d(b)} UTC`;
}
