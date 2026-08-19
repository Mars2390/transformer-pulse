import { describe, expect, it } from "vitest";

import {
  analyseDataset,
  nemaUnbalancePct,
  ratedPhaseCurrent,
  type PhaseReading,
} from "./load-analysis";
import { deriveSnapshot, pickSnapshotRow, snapshotArithmetic } from "./analysis-snapshot";
import { buildLoadAlerts } from "./load-alerts";
import { computeThermal } from "./transformer-thermal";
import { IEC_DEFAULTS, resolveThermalConstants } from "./thermal-constants";
import { formatVerifyReport, verifySnapshot } from "./analysis-verify";

/**
 * G-38104 — the case that exposed the bug.
 *
 * The three figures below are the ones the fix has to reproduce:
 *
 *   Loading   130.98 %
 *   Unbalance  42.72 %   (NEMA MG-1, by hand, on the SAME reading)
 *   Hot-spot  138.38 degC (IEC 60076-7 with the default constants)
 *
 * Provenance, stated plainly: the snapshot amps below are the reading that
 * reproduces those three published figures exactly and self-consistently —
 * 412.6 kVA on a 315 kVA unit is 130.98%, and 819.2 / 512.4 / 390.4 A about a
 * 574.0 A mean is 42.7178%. Confirm them against the EMDis export before this
 * fixture is cited as measured data; scripts/verify-analysis.mts runs the same
 * comparison against the real stored rows.
 *
 * Ambient 23 degC is not an assumption either — it is ambientForMonth(4), the
 * Nairobi May figure in load-balancing.ts, and the month the export covers.
 */
const G38104 = {
  label: "G-38104",
  ratingKva: 315,
  voltLL: 415,
  ambientC: 23,
  peak: {
    recordedAt: new Date("2026-05-14T19:08:00Z"),
    l1c: 819.2,
    l2c: 512.4,
    l3c: 390.4,
    neutralC: 382.7,
    kva: 412.6,
    kw: 383.7,
    pf: 0.93,
    thdPct: 6.4,
    l1nV: 228.0,
    l2nV: 236.0,
    l3nV: 239.0,
  },
};

/**
 * Three readings, chosen to recreate the exact failure mode. The two light
 * readings carry huge PERCENTAGE unbalance on tiny currents — 125% and 170% —
 * which is where the old "136%" headline came from. A near-idle transformer is
 * not the transformer anyone is being asked to act on.
 */
function window3(): (PhaseReading & { recordedAt: Date })[] {
  const p = G38104.peak;
  return [
    {
      recordedAt: new Date("2026-05-14T04:00:00Z"),
      l1c: 90, l2c: 5, l3c: 5, neutralC: 84,
      l1nV: 241, l2nV: 241, l3nV: 241,
      kva: 25.1, kw: 23.4, pf: 0.93, thdPct: 3.1,
    },
    {
      recordedAt: new Date("2026-05-14T11:00:00Z"),
      l1c: 60, l2c: 12, l3c: 8, neutralC: 51,
      l1nV: 240, l2nV: 240, l3nV: 240,
      kva: 19.4, kw: 18.0, pf: 0.93, thdPct: 3.4,
    },
    {
      recordedAt: p.recordedAt,
      l1c: p.l1c, l2c: p.l2c, l3c: p.l3c, neutralC: p.neutralC,
      l1nV: p.l1nV, l2nV: p.l2nV, l3nV: p.l3nV,
      kva: p.kva, kw: p.kw, pf: p.pf, thdPct: p.thdPct,
    },
  ];
}

function snapshotOfG38104(transformer: Parameters<typeof deriveSnapshot>[0]["transformer"] = null) {
  const rows = window3();
  const picked = pickSnapshotRow(rows.map((r) => ({ ...r, loadingPct: (r.kva ?? 0) / 315 * 100 })))!;
  return deriveSnapshot({
    row: picked.row,
    index: picked.index,
    selectedBecause: picked.reason,
    ratingKva: G38104.ratingKva,
    voltLL: G38104.voltLL,
    ambientC: G38104.ambientC,
    transformer,
  });
}

describe("NEMA unbalance is a single-snapshot quantity", () => {
  it("is max deviation from the mean over the mean", () => {
    // 819.2 / 512.4 / 390.4 -> mean 574.0, worst deviation 245.2
    expect(nemaUnbalancePct(819.2, 512.4, 390.4)).toBeCloseTo(42.7178, 4);
    expect(nemaUnbalancePct(819.2, 512.4, 390.4).toFixed(2)).toBe("42.72");
  });

  it("is zero for a perfectly balanced reading and order-independent", () => {
    expect(nemaUnbalancePct(300, 300, 300)).toBeCloseTo(0, 9);
    expect(nemaUnbalancePct(390.4, 819.2, 512.4)).toBeCloseTo(42.7178, 4);
    expect(nemaUnbalancePct(512.4, 390.4, 819.2)).toBeCloseTo(42.7178, 4);
  });

  it("does not report a defect on an unloaded transformer", () => {
    // Dividing by a near-zero mean is noise, not a finding.
    expect(nemaUnbalancePct(0.4, 0.1, 0)).toBe(0);
  });
});

describe("G-38104: loading and unbalance come from the SAME reading", () => {
  const s = snapshotOfG38104();

  it("reproduces the published loading", () => {
    expect(s.loadingPct).toBeCloseTo(130.9841, 3);
    expect(s.loadingPct.toFixed(2)).toBe("130.98");
  });

  it("reproduces the manual NEMA MG-1 unbalance", () => {
    expect(s.unbalancePct).toBeCloseTo(42.7178, 3);
    expect(s.unbalancePct.toFixed(2)).toBe("42.72");
  });

  it("reproduces the hot-spot with the IEC default constants", () => {
    expect(s.constants).toEqual(IEC_DEFAULTS);
    expect(s.topOilRiseK).toBeCloseTo(79.9608, 2);
    expect(s.topOilC).toBeCloseTo(102.9608, 2);
    expect(s.hotSpotRiseK).toBeCloseTo(35.4224, 2);
    expect(s.hotSpotC).toBeCloseTo(138.3832, 2);
    expect(s.hotSpotC.toFixed(2)).toBe("138.38");
  });

  it("carries the supporting arithmetic so the number can be checked by hand", () => {
    expect(s.meanPhaseA).toBeCloseTo(574.0, 6);
    expect(s.worstDeviationA).toBeCloseTo(245.2, 6);
    expect(s.ratedPhaseA).toBeCloseTo(438.2297, 3);
    expect(s.maxPhasePctRated).toBeCloseTo(186.9339, 2);
    expect(s.neutralPctRated).toBeCloseTo(87.3284, 2);
    expect(s.unbalanceLossFactor).toBeCloseTo(1.09877, 4);
    expect(snapshotArithmetic(s)).toContain("42.72%");
  });

  it("still reports the worst-winding hot-spot, which is far higher", () => {
    // The gap between 138 degC on the kVA basis and 220 degC on the hottest
    // winding IS the finding. It must not be averaged away.
    expect(s.hotSpotByPhaseC).toBeGreaterThan(200);
  });

  it("ages the paper about a hundred times faster than normal", () => {
    expect(s.ageingRate).toBeCloseTo(106.2, 0);
  });
});

describe("no time-window aggregation leaks into the headline", () => {
  const a = analyseDataset(window3(), G38104.ratingKva, G38104.voltLL);

  it("picks the peak-loading reading as the snapshot", () => {
    expect(a.snapshot.recordedAt.toISOString()).toBe("2026-05-14T19:08:00.000Z");
    expect(a.snapshot.selectedBecause).toContain("peak measured loading");
  });

  it("returns 42.72% and nothing else", () => {
    expect(a.unbalancePct.toFixed(2)).toBe("42.72");
    expect(a.snapshot.unbalancePct.toFixed(2)).toBe("42.72");
    // The compatibility shim: every legacy key is the same number, so no old
    // call site can quote a different one.
    expect(a.unbalance.pct).toBe(a.unbalancePct);
    expect(a.unbalance.median).toBe(a.unbalancePct);
    expect(a.unbalance.p95).toBe(a.unbalancePct);
    expect(a.unbalance.max).toBe(a.unbalancePct);
  });

  it("keeps the window spread, clearly separated, and it is NOT the headline", () => {
    // These are the numbers that used to be quoted as "the unbalance".
    expect(a.unbalanceWindow.maxPct).toBeCloseTo(170, 0);
    expect(a.unbalanceWindow.medianPct).toBeCloseTo(125, 0);
    expect(a.unbalanceWindow.maxPct).not.toBeCloseTo(a.unbalancePct, 1);
  });

  it("states the unbalance to two decimals in the finding, with the arithmetic", () => {
    const f = a.findings.find((x) => x.code === "PHASE_UNBALANCE");
    expect(f).toBeDefined();
    expect(f!.headline).toContain("42.72%");
    expect(f!.detail).toContain("819.2");
    expect(f!.detail).toContain("574.0");
  });
});

describe("the alert generator quotes the stored snapshot, it does not calculate", () => {
  const s = snapshotOfG38104();
  const alerts = buildLoadAlerts({
    transformerId: "tx_g38104",
    label: "G-38104",
    region: "NAIROBI",
    snapshot: s,
    window: { minutesAnyPhaseOverRated: 149, hiddenOverloadMinutes: 0, longestExcursionMinutes: 92 },
  });

  it("raises the unbalance alert with the API's own number", () => {
    const unb = alerts.find((x) => x.type === "PHASE_UNBALANCE");
    expect(unb).toBeDefined();
    expect(unb!.severity).toBe("CRITICAL");
    expect(unb!.message).toContain("42.72%");
    expect(unb!.message).toContain(s.unbalancePct.toFixed(2));
  });

  it("never emits a median or a window peak", () => {
    const text = alerts.map((x) => x.message).join(" | ");
    expect(text).not.toContain("for half the window");
    expect(text).not.toContain("170");
    expect(text).not.toContain("125.00%");
  });

  it("quotes the same loading and hot-spot as the API field", () => {
    const overload = alerts.find((x) => x.type === "SINGLE_PHASE_OVERLOAD");
    expect(overload!.message).toContain("130.98%");
    expect(overload!.message).toContain(s.hotSpotC.toFixed(2));
  });
});

describe("thermal constants come from the schema, with IEC as the fallback", () => {
  it("uses IEC 60076-7 Table 4 when the record is empty", () => {
    const r = resolveThermalConstants(null);
    expect(r.constants).toEqual(IEC_DEFAULTS);
    expect(r.anyFromRecord).toBe(false);
    expect(r.provenance).toContain("IEC 60076-7");
  });

  it("uses IEC defaults for the individual nulls only", () => {
    const r = resolveThermalConstants({ lossRatioR: 7.4, topOilRiseK: null });
    expect(r.constants.lossRatioR).toBe(7.4);
    expect(r.constants.topOilRiseK).toBe(IEC_DEFAULTS.topOilRiseK);
    expect(r.origin.lossRatioR).toBe("record");
    expect(r.origin.topOilRiseK).toBe("default");
  });

  it("takes all five off a manufacturer test certificate", () => {
    const r = resolveThermalConstants({
      lossRatioR: 6.8,
      topOilRiseK: 52,
      hotSpotGradientK: 20,
      windingExponentX: 0.9,
      oilExponentY: 1.5,
    });
    expect(r.constants).toEqual({
      lossRatioR: 6.8, topOilRiseK: 52, hotSpotGradientK: 20, exponentX: 0.9, exponentY: 1.5,
    });
    expect(r.provenance).toContain("All five");
  });

  it("refuses a nonsense value rather than reporting a cold transformer", () => {
    // A zero oil rise would make every unit look safe at any load. That is the
    // one failure mode this code must never have.
    const r = resolveThermalConstants({ topOilRiseK: 0, lossRatioR: -3 });
    expect(r.constants.topOilRiseK).toBe(55);
    expect(r.constants.lossRatioR).toBe(5);
    expect(r.origin.topOilRiseK).toBe("rejected");
    expect(r.provenance).toContain("Rejected as out of range");
  });

  it("does not claim certificate provenance for a value that IS the IEC figure", () => {
    // Every new Transformer row is created with the schema defaults 5 / 55 / 23
    // / 0.8 / 1.6. Reporting those as test-certificate data would be a lie on
    // the face of a report an engineer signs.
    const r = resolveThermalConstants({
      lossRatioR: 5, topOilRiseK: 55, hotSpotGradientK: 23,
      windingExponentX: 0.8, oilExponentY: 1.6,
    });
    expect(r.constants).toEqual(IEC_DEFAULTS);
    expect(r.anyFromRecord).toBe(false);
    expect(r.provenance).toContain("IEC 60076-7");
  });

  it("changes the hot-spot when the certificate differs from IEC", () => {
    const iec = snapshotOfG38104(null);
    const certified = snapshotOfG38104({
      lossRatioR: 6.8, topOilRiseK: 52, hotSpotGradientK: 20,
      windingExponentX: 0.8, oilExponentY: 1.6,
    });
    expect(certified.hotSpotC).not.toBeCloseTo(iec.hotSpotC, 1);
    expect(certified.constantsProvenance).toContain("All five");
    // Same load, same ambient — only the constants moved.
    expect(certified.loadingPct).toBeCloseTo(iec.loadingPct, 9);
    expect(certified.unbalancePct).toBeCloseTo(iec.unbalancePct, 9);
  });

  it("no longer double-counts a hot-spot factor", () => {
    // The old engine multiplied a 23 K certificate gradient by H = 1.1.
    const t = computeThermal({ loadKva: 315, ratingKva: 315, ambientC: 0 });
    expect(t.hotspotRiseK).toBeCloseTo(23, 9);
    expect(t.topOilRiseK).toBeCloseTo(55, 9);
  });

  it("does not invent R from defaulted loss figures", () => {
    const t = computeThermal({ loadKva: 400, ratingKva: 315, ambientC: 23 });
    expect(t.constants.lossRatioR).toBe(5);
    expect(t.lossRatioSource).toBe("IEC default");
  });

  it("prefers the certificate constant over measured losses", () => {
    const t = computeThermal({
      loadKva: 400, ratingKva: 315, ambientC: 23,
      noLoadLossW: 500, loadLossW: 4200,
      transformer: { lossRatioR: 5.5 },
    });
    expect(t.constants.lossRatioR).toBe(5.5);
    expect(t.lossRatioSource).toBe("certificate constant");
  });

  it("falls back to measured losses when the record has no ratio", () => {
    const t = computeThermal({
      loadKva: 400, ratingKva: 315, ambientC: 23,
      noLoadLossW: 500, loadLossW: 4200,
    });
    expect(t.constants.lossRatioR).toBeCloseTo(8.4, 6);
    expect(t.lossRatioSource).toBe("measured losses");
  });
});

describe("manual == system", () => {
  const s = snapshotOfG38104();
  const report = verifySnapshot(
    {
      label: "G-38104",
      l1A: G38104.peak.l1c,
      l2A: G38104.peak.l2c,
      l3A: G38104.peak.l3c,
      neutralA: G38104.peak.neutralC,
      kva: G38104.peak.kva,
      ratingKva: G38104.ratingKva,
      voltLL: G38104.voltLL,
      ambientC: G38104.ambientC,
    },
    s,
  );

  it("agrees on every quantity", () => {
    if (!report.allOk) {
      // Print the table so CI shows WHICH quantity disagreed, not just a red X.
      console.error(formatVerifyReport(report));
    }
    expect(report.failures.map((f) => f.quantity)).toEqual([]);
    expect(report.allOk).toBe(true);
  });

  it("checks the three published figures explicitly", () => {
    const get = (q: string) => report.rows.find((r) => r.quantity === q)!;
    expect(get("Loading").manual.toFixed(2)).toBe("130.98");
    expect(get("Unbalance (NEMA MG-1)").manual.toFixed(2)).toBe("42.72");
    expect(get("Hot-spot temperature").manual.toFixed(2)).toBe("138.38");
    expect(get("Loading").system.toFixed(2)).toBe("130.98");
    expect(get("Unbalance (NEMA MG-1)").system.toFixed(2)).toBe("42.72");
    expect(get("Hot-spot temperature").system.toFixed(2)).toBe("138.38");
  });

  it("has a rated phase current an engineer can check on a calculator", () => {
    expect(ratedPhaseCurrent(315, 415)).toBeCloseTo(438.2297, 3);
  });
});
