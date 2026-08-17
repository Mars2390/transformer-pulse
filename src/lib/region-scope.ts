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

/**
 * Do two free-text regions refer to the same place?
 *
 * Regions are typed by hand in three tables, so "Nairobi North", "NAIROBI
 * NORTH" and "Nairobi-North" are all the same patch of city. Comparison is on
 * the base token, case-insensitively, in both directions — a unit going to
 * "Nairobi West" is accepted for an engineer whose region reads "Nairobi",
 * because a broader region contains a narrower one.
 *
 * A missing region on either side returns true rather than false: refusing an
 * assignment because somebody's profile is incomplete would block real work to
 * enforce data tidiness, which is the wrong trade in the field.
 */
export function sameRegion(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = baseRegion(a);
  const y = baseRegion(b);
  if (!x || !y) return true;
  const lx = x.toLowerCase();
  const ly = y.toLowerCase();
  return lx === ly || lx.includes(ly) || ly.includes(lx);
}

/**
 * The scope a signed-in user may see, as a Prisma `where` fragment.
 *
 * This exists because a STORE_MANAGER's scope is a DIFFERENT KIND of thing from
 * a manager's. A manager is scoped by region, which is free text matched with
 * `contains`; a store manager is scoped by a foreign key. Reusing regionWhere()
 * for both would mean a store manager at "Ruaraka" in region "Nairobi North"
 * seeing every transformer in Nairobi North — every other store included.
 *
 * A store manager with no store assigned matches NOTHING, deliberately. The
 * safe failure for a scoping bug is an empty screen somebody reports, not a
 * full one nobody questions.
 */
export function visibleTransformerWhere(user: {
  role: string;
  region?: string | null;
  storeId?: string | null;
}): Record<string, unknown> {
  if (user.role === "STORE_MANAGER") {
    return user.storeId ? { currentStoreId: user.storeId } : { id: "__no_store_assigned__" };
  }
  return regionWhere(user.region, user.role);
}

/** The same rule for anything joined to a store rather than holding one. */
export function visibleStoreWhere(user: {
  role: string;
  region?: string | null;
  storeId?: string | null;
}): Record<string, unknown> {
  if (user.role === "STORE_MANAGER") {
    return user.storeId ? { storeId: user.storeId } : { id: "__no_store_assigned__" };
  }
  return {};
}

/** Can this person approve for this store? Admin and manager: yes. Store manager: only theirs. */
export function canApproveForStore(
  user: { role: string; storeId?: string | null },
  storeId: string | null | undefined,
): boolean {
  if (user.role === "ADMIN" || user.role === "MANAGER") return true;
  if (user.role === "STORE_MANAGER") return Boolean(user.storeId) && user.storeId === storeId;
  return false;
}

/**
 * Consignments this person may act on.
 *
 * A batch has no region of its own — it has a STORE, and the store has the
 * region. That indirection is why the region filter was missing here for
 * regional managers while being present for store managers: it is one level
 * further down than every other scope in the codebase, so it was easy to leave
 * out, and the symptom is quiet — a Nairobi manager simply also sees Mombasa's
 * consignments and has no way to tell they are not theirs.
 *
 * A batch with NO store still shows to a regional manager rather than
 * vanishing. An orphaned consignment is a data problem somebody has to notice,
 * and a filter that hides it is a filter that guarantees nobody ever does.
 */
export function visibleBatchWhere(user: {
  role: string;
  region?: string | null;
  storeId?: string | null;
}): Record<string, unknown> {
  if (user.role === "ADMIN") return {};
  if (user.role === "STORE_MANAGER") {
    return { storeId: user.storeId ?? "__no_store_assigned__" };
  }
  const scope = regionWhere(user.region, user.role);
  if (!("region" in scope)) return {};
  return { OR: [{ store: scope }, { storeId: null }] };
}
