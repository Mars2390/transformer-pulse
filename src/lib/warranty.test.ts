import { describe, expect, it } from "vitest";

import { EXPIRING_SOON_DAYS, computeWarranty } from "./warranty";

/**
 * Dates are built with the local constructor, not an ISO string, because
 * computeWarranty() adds months with setMonth() — a local-time operation. An ISO
 * midnight would make these assertions pass in UTC and fail in Nairobi.
 */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("computeWarranty", () => {
  it("is under warranty well before expiry", () => {
    const info = computeWarranty(d(2025, 1, 15), 24, d(2025, 6, 1));
    expect(info.state).toBe("UNDER_WARRANTY");
    expect(info.claimable).toBe(true);
    expect(info.expiresAt?.getFullYear()).toBe(2027);
    expect(info.expiresAt?.getMonth()).toBe(0);
    expect(info.expiresAt?.getDate()).toBe(15);
  });

  it("is expired one day after expiry, and not claimable", () => {
    const info = computeWarranty(d(2023, 1, 15), 24, d(2025, 1, 16));
    expect(info.state).toBe("EXPIRED");
    expect(info.claimable).toBe(false);
    expect(info.monthsRemaining).toBe(0);
  });

  it("is expired on the day it expires — cover ends, it does not linger", () => {
    const info = computeWarranty(d(2023, 1, 15), 24, d(2025, 1, 15));
    expect(info.state).toBe("EXPIRED");
    expect(info.claimable).toBe(false);
  });

  it("treats warrantyMonths: 0 as no cover at all, never as unlimited", () => {
    const info = computeWarranty(d(2025, 1, 15), 0, d(2025, 1, 16));
    expect(info.state).toBe("EXPIRED");
    expect(info.claimable).toBe(false);
  });

  it("reports NOT_STARTED when the clock has not started", () => {
    const info = computeWarranty(null, 24, d(2025, 6, 1));
    expect(info.state).toBe("NOT_STARTED");
    expect(info.expiresAt).toBeNull();
    expect(info.daysRemaining).toBeNull();
    expect(info.claimable).toBe(false);
  });

  it("warns while expiry is inside the notice window", () => {
    const info = computeWarranty(d(2025, 1, 15), 12, d(2025, 12, 16));
    expect(info.state).toBe("EXPIRING_SOON");
    expect(info.claimable).toBe(true);
    expect(info.daysRemaining).toBeLessThanOrEqual(EXPIRING_SOON_DAYS);
  });

  /**
   * 31 January plus one month.
   *
   * setMonth() has no notion of a short month, so 31 February normalises
   * forward to 3 March. This test does not argue that is the right answer — it
   * pins down which answer we give, so a claim on 2 March is decided the same
   * way twice and nobody discovers the rollover during an argument with a
   * manufacturer.
   */
  it("rolls a month-end start date forward rather than clamping it", () => {
    const info = computeWarranty(d(2025, 1, 31), 1, d(2025, 2, 1));
    expect(info.expiresAt?.getMonth()).toBe(2);
    expect(info.expiresAt?.getDate()).toBe(3);
  });
});
