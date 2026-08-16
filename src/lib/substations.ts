import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Substations, without a substations table.
 *
 * KPLC substations already exist in this database in three places — the
 * substationCode carried by a transformer, by a SubstationInspection, and by an
 * EMDis dataset — and in none of them as a row of their own. Adding a
 * Substation model would mean a migration against a live database and a
 * backfill of three free-text columns that disagree with each other about
 * spelling and spacing.
 *
 * So a substation here IS its code. The code is the join key, it is already
 * indexed (schema: @@index([substationCode])), and "does this substation exist"
 * is answered by asking whether anything in the system has ever mentioned it.
 * That is a weaker guarantee than a foreign key and it is stated plainly rather
 * than dressed up: two records spelling the same substation differently are two
 * substations here, which is why every write goes through normaliseSubstationCode
 * first.
 *
 * When there is a reason to promote this to a real table, every call site is in
 * this file and the shape below is what that table would hold.
 */

export type SubstationRef = {
  /** The normalised code. This is the identity. */
  code: string;
  /** Best-known name, or null if nothing in the system has ever named it. */
  name: string | null;
  /** True when something in the system already referenced this code. */
  existed: boolean;
  /** Where the name was found, for the "auto-linked" message. */
  foundVia: "transformer" | "inspection" | "emdis" | null;
};

/**
 * One spelling per substation.
 *
 * Uppercased, outer whitespace gone, internal runs of whitespace collapsed to a
 * single space. Deliberately conservative: it does NOT strip punctuation or
 * leading zeros, because "014537" and "14537" may well be different substations
 * in a utility's numbering and guessing otherwise would silently merge two
 * networks.
 */
export function normaliseSubstationCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

/** Display form: "14537 — LEE PIC ACADEMY", or just the code when unnamed. */
export function formatSubstation(code: string, name?: string | null): string {
  return name ? `${code} — ${name}` : code;
}

/**
 * Look a substation up across every table that mentions one.
 *
 * Transformers first (a name attached to a sibling unit is the most relevant),
 * then inspections, then EMDis headers. A code nobody has ever recorded comes
 * back with existed: false — which is not an error. It is a field engineer
 * standing at a substation this system has not heard of yet, which is the
 * entire point of letting them onboard.
 */
export async function lookupSubstation(
  code: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<SubstationRef> {
  const normalised = normaliseSubstationCode(code);

  const fromTransformer = await client.transformer.findFirst({
    where: { substationCode: normalised },
    select: { substationName: true },
    orderBy: { updatedAt: "desc" },
  });
  if (fromTransformer) {
    return { code: normalised, name: fromTransformer.substationName ?? null, existed: true, foundVia: "transformer" };
  }

  const fromInspection = await client.substationInspection.findFirst({
    where: { substationCode: normalised },
    select: { substationName: true },
    orderBy: { createdAt: "desc" },
  });
  if (fromInspection) {
    return { code: normalised, name: fromInspection.substationName ?? null, existed: true, foundVia: "inspection" };
  }

  // EMDis headers carry the code but no substation name column, so this can
  // only ever answer "yes, this substation is real" — never what it is called.
  const fromEmdis = await client.emdisDataset.findFirst({
    where: { substationCode: normalised },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (fromEmdis) {
    return { code: normalised, name: null, existed: true, foundVia: "emdis" };
  }

  return { code: normalised, name: null, existed: false, foundVia: null };
}
