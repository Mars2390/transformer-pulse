/**
 * Region scoping that survives how people actually write region names.
 *
 * KPLC's own data says "NAIROBI". The accounts said "Nairobi North". A manager
 * saw two transformers out of 930, and every fix that chased an exact string
 * match broke again the next time a file arrived spelled differently.
 *
 * So matching is done on the BASE region — the first word — case-insensitively.
 * "Nairobi North", "NAIROBI", "Nairobi West" and "nairobi south" all scope to
 * the same fleet. A manager for Nairobi sees Nairobi.
 *
 * This is deliberately generous. The alternative failure modes are not
 * symmetric: a manager seeing a neighbouring sub-region's transformer is a
 * mild annoyance, while a manager seeing NOTHING — which is what happened —
 * makes the whole system look broken and hides real faults.
 */

/** "Nairobi North" -> "Nairobi". "NAIROBI" -> "NAIROBI". */
export function baseRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const first = region.trim().split(/[\s,/-]+/)[0];
  return first && first.length >= 3 ? first : region.trim() || null;
}

/**
 * A Prisma `where` fragment scoping to a user's region.
 *
 * Returns `{}` for an admin or anyone with no region — they see everything,
 * which is the existing behaviour and is what an administrator expects.
 */
export function regionWhere(
  region: string | null | undefined,
  role?: string | null,
): { region?: { contains: string; mode: "insensitive" } } {
  if (role === "ADMIN") return {};
  const base = baseRegion(region);
  if (!base) return {};
  return { region: { contains: base, mode: "insensitive" } };
}

/**
 * The same scope one level down, for models that reach a transformer through a
 * relation (alerts, inspections, events).
 */
export function nestedRegionWhere(
  region: string | null | undefined,
  role?: string | null,
): { region?: { contains: string; mode: "insensitive" } } {
  return regionWhere(region, role);
}

/** Does this transformer fall inside the user's region? For in-memory filtering. */
export function inRegion(
  transformerRegion: string | null | undefined,
  userRegion: string | null | undefined,
  role?: string | null,
): boolean {
  if (role === "ADMIN") return true;
  const base = baseRegion(userRegion);
  if (!base) return true;
  if (!transformerRegion) return false;
  return transformerRegion.toLowerCase().includes(base.toLowerCase());
}
