import { describe, expect, it } from 'vitest';
import { nemaUnbalancePct, ratedPhaseCurrent } from './load-analysis';
import { deriveSnapshot, pickSnapshotRow } from './analysis-snapshot';
import { computeThermal } from './transformer-thermal';
import {
  IEEE_NORMAL_LIFE_YEARS,
  NORMAL_LIFE_YEARS,
  lifeFromAgeing,
  round3,
  timeToFailureYears,
} from './time-to-failure';

/**
 * G-38104, the snapshot reading. 315 kVA, 415 V, ambient 23 degC (Nairobi, May).
 * These are the numbers the manual NEMA MG-1 and IEC 60076-7 check was done on.
 */
const SNAP = {
  recordedAt: new Date('2026-05-14T20:08:00.000Z'),
  l1c: 819.2, l2c: 512.4, l3c: 390.4, neutralC: 382.7,
  kva: 412.6, maxPhaseC: 819.2, loadingPct: 130.9841,
};
const RATING_KVA = 315;
const VOLT_LL = 415;
const AMBIENT_C = 23;

describe('one value everywhere: unbalance', () => {
  it('reproduces the manual NEMA MG-1 figure from the snapshot', () => {
    // I_avg = (819.2 + 512.4 + 390.4) / 3 = 574.0 A
    // max deviation = 819.2 - 574.0 = 245.2 A
    // 245.2 / 574.0 x 100 = 42.7178%
    expect(nemaUnbalancePct(819.2, 512.4, 390.4)).toBeCloseTo(42.7178, 4);
  });

  it('gives the API field, the alert and the health record the SAME number', () => {
    const metrics = deriveSnapshot({ row: SNAP, ratingKva: RATING_KVA, voltLL: VOLT_LL, ambientC: AMBIENT_C });

    // The three former call sites, now all reading one derivation.
    const apiField = metrics.unbalancePct;
    const alertValue = metrics.unbalancePct;
    const healthRecord = metrics.unbalancePct;

    expect(apiField).toBeCloseTo(42.7178, 4);
    expect(alertValue).toBe(apiField);
    expect(healthRecord).toBe(apiField);
    expect(Number(apiField.toFixed(2))).toBe(42.72);

    // And it is the same reading loadingPct came from. That was the whole bug.
    expect(metrics.loadingPct).toBeCloseTo(130.9841, 4);
    expect(metrics.maxPhasePctRated).toBeCloseTo(186.9339, 3);
    expect(metrics.ratedPhaseA).toBeCloseTo(ratedPhaseCurrent(RATING_KVA, VOLT_LL), 6);
  });

  it('refuses to drift when the window contains hotter and calmer minutes', () => {
    // A median across this window lands near 136%, and the max of the hourly
    // maxima near 171%. Both are legitimate answers to OTHER questions. The
    // snapshot must be immune to them.
    const window = [
      { l1c: 120, l2c: 118, l3c: 119, kva: 82, maxPhaseC: 120, loadingPct: 26.0, recordedAt: new Date('2026-05-14T19:00:00Z') },
      { l1c: 980, l2c: 210, l3c: 180, kva: 300, maxPhaseC: 980, loadingPct: 95.2, recordedAt: new Date('2026-05-14T19:30:00Z') },
      { ...SNAP },
      { l1c: 700, l2c: 300, l3c: 250, kva: 380, maxPhaseC: 700, loadingPct: 120.6, recordedAt: new Date('2026-05-14T20:30:00Z') },
    ];

    const picked = pickSnapshotRow(window)!;
    expect(picked.reason).toMatch(/peak measured loading/);
    expect(picked.row.kva).toBe(412.6);

    const metrics = deriveSnapshot({
      row: picked.row, ratingKva: RATING_KVA, voltLL: VOLT_LL, ambientC: AMBIENT_C,
      selectedBecause: picked.reason,
    });
    expect(metrics.unbalancePct).toBeCloseTo(42.7178, 4);

    // Prove the discarded aggregations really were different numbers, so this
    // test fails loudly if anyone reintroduces one of them.
    const each = window.map((r) => nemaUnbalancePct(r.l1c, r.l2c, r.l3c));
    const sorted = [...each].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const peak = Math.max(...each);
    expect(median).not.toBeCloseTo(metrics.unbalancePct, 1);
    expect(peak).not.toBeCloseTo(metrics.unbalancePct, 1);
  });

  it('reports an unloaded transformer as balanced, not as 200% unbalanced', () => {
    expect(nemaUnbalancePct(0.4, 0, 0.1)).toBe(0);
  });
});

describe('time to failure follows the ageing rate', () => {
  const thermal = computeThermal({
    loadKva: (SNAP.loadingPct / 100) * RATING_KVA,
    ratingKva: RATING_KVA,
    ambientC: AMBIENT_C,
    powerFactor: 0.95,
  });

  it('lands on the manual hot-spot with the IEC default constants', () => {
    expect(thermal.hotspotC).toBeCloseTo(138.3831, 3);
  });

  it('derives ageing from that same hot-spot', () => {
    // V = 2 ^ ((138.3831 - 98) / 6) = 106.19x
    expect(thermal.ageingRate).toBeCloseTo(106.1912, 3);
    expect(thermal.ageingRate).toBeCloseTo(Math.pow(2, (thermal.hotspotC - 98) / 6), 6);
  });

  it('is the exact inverse of the ageing rate, with no rounding loss', () => {
    const life = lifeFromAgeing(thermal.ageingRate);
    // The identity that was broken: TTF x rate must equal the life basis.
    expect(life.yearsToEndOfLife * thermal.ageingRate).toBeCloseTo(NORMAL_LIFE_YEARS, 9);
    expect(life.yearsToEndOfLife).toBeCloseTo(0.2825, 4);

    // round1() used to print 0.3 for this. Three decimals keeps the figure
    // reproducible by hand; one decimal did not.
    expect(round3(life.yearsToEndOfLife)).toBe(0.283);
    expect(Math.round(life.yearsToEndOfLife * 10) / 10).toBe(0.3);
  });

  it('explains which life basis produced the number', () => {
    // A manual check against IEEE C57.91 (180,000 h = 20.55 y) at 105.61x
    // gives 0.195 y. Against the IEC 30 y design basis the same rate gives
    // 0.284 y. Both are right; only one can be printed unlabelled, so the
    // basis travels with the number.
    expect(timeToFailureYears(105.61, IEEE_NORMAL_LIFE_YEARS)).toBeCloseTo(0.1946, 4);
    expect(timeToFailureYears(105.61, NORMAL_LIFE_YEARS)).toBeCloseTo(0.2841, 4);
    expect(lifeFromAgeing(105.61).arithmetic).toContain('30.00 y / 105.61x');
  });

  it('never divides by a zero ageing rate', () => {
    expect(Number.isFinite(timeToFailureYears(0))).toBe(true);
    expect(Number.isFinite(timeToFailureYears(Number.NaN))).toBe(true);
  });
});
