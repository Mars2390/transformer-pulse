import { describe, expect, it } from "vitest";

import {
  baseRegion,
  regionWhere,
  sameRegion,
  visibleTransformerWhere,
} from "./region-scope";

describe("baseRegion", () => {
  it("takes the region off a sub-region", () => {
    expect(baseRegion("Nairobi North")).toBe("Nairobi");
    expect(baseRegion("Nairobi")).toBe("Nairobi");
  });

  it("has nothing to say about nothing", () => {
    expect(baseRegion(null)).toBeNull();
    expect(baseRegion(undefined)).toBeNull();
    expect(baseRegion("")).toBeNull();
  });
});

describe("regionWhere", () => {
  it("scopes a regional user to their base region", () => {
    expect(regionWhere("Nairobi North", "STORE_KEEPER")).toEqual({
      region: { contains: "Nairobi", mode: "insensitive" },
    });
  });

  it("does not scope an ADMIN at all", () => {
    expect(regionWhere("Nairobi North", "ADMIN")).toEqual({});
  });

  it("returns an empty filter when there is no region to filter on", () => {
    // An empty filter is the honest answer: a where fragment that matched
    // nothing would hide rows from somebody whose region simply is not recorded.
    expect(regionWhere(null, "STORE_KEEPER")).toEqual({});
  });
});

describe("sameRegion", () => {
  it("is symmetric", () => {
    expect(sameRegion("Nairobi North", "Nairobi")).toBe(true);
    expect(sameRegion("Nairobi", "Nairobi North")).toBe(true);
    expect(sameRegion("Nairobi", "Mombasa")).toBe(false);
    expect(sameRegion("Mombasa", "Nairobi")).toBe(false);
  });

  it("ignores case, because regions are typed by hand", () => {
    expect(sameRegion("nairobi north", "NAIROBI")).toBe(true);
  });

  /**
   * Unknown on either side is permissive, deliberately.
   *
   * A null region means we do not know where this belongs, and refusing the
   * comparison would silently hide real assets from the person responsible for
   * them. The scope is a convenience, not the authorisation — that is done by
   * role, server-side.
   */
  it("is true when either side is unknown", () => {
    expect(sameRegion(null, "Nairobi")).toBe(true);
    expect(sameRegion("Nairobi", null)).toBe(true);
    expect(sameRegion(undefined, undefined)).toBe(true);
  });
});

describe("visibleTransformerWhere", () => {
  it("pins a store manager to their own store by foreign key, not by region", () => {
    expect(visibleTransformerWhere({ role: "STORE_MANAGER", storeId: "store-1" })).toEqual(
      { currentStoreId: "store-1" },
    );
  });

  /**
   * A store manager with no store sees nothing at all.
   *
   * The alternative — falling through to a region filter — would show them every
   * transformer in the region the day somebody forgets to set their store, which
   * is exactly the leak the separate role exists to prevent. An impossible id is
   * a filter that matches nothing and cannot be widened by accident.
   */
  it("shows a store manager with no store nothing", () => {
    const where = visibleTransformerWhere({ role: "STORE_MANAGER", storeId: null });
    expect(where).toEqual({ id: "__no_store_assigned__" });
  });

  it("leaves an ADMIN unfiltered", () => {
    expect(visibleTransformerWhere({ role: "ADMIN", region: "Nairobi" })).toEqual({});
  });

  it("scopes everybody else by region", () => {
    expect(
      visibleTransformerWhere({ role: "FIELD_ENGINEER", region: "Nairobi North" }),
    ).toEqual({ region: { contains: "Nairobi", mode: "insensitive" } });
  });
});
