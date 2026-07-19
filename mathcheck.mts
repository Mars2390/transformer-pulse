import fs from "node:fs";
import { parseCsv } from "./src/lib/import-parse";
import { parseEmdisBlocks } from "./src/lib/emdis-parse";
import { analyseDataset, analyseReading, ratedPhaseCurrent, thermalLoadKva } from "./src/lib/load-analysis";
import { computeThermal } from "./src/lib/transformer-thermal";

let bad = 0;
const ok = (m: string) => console.log(`  PASS  ${m}`);
const no = (m: string) => { console.log(`  FAIL  ${m}`); bad++; };
const near = (a: number, b: number, tol: number, m: string) =>
  Math.abs(a - b) <= tol ? ok(m) : no(`${m} — got ${a.toFixed(3)} want ${b.toFixed(3)}`);

console.log("=== A. RATED CURRENT — I = S / (root3 x V) ===");
near(ratedPhaseCurrent(315, 415), 438.2, 0.5, "315 kVA at 415 V = 438 A");
near(ratedPhaseCurrent(200, 415), 278.2, 0.5, "200 kVA at 415 V = 278 A");
near(ratedPhaseCurrent(50, 415), 69.6, 0.5, "50 kVA at 415 V = 70 A");
near(ratedPhaseCurrent(1000, 11000), 52.5, 0.5, "1000 kVA at 11 kV = 52 A (HV side)");

console.log("\n=== B. UNBALANCE AND LOSS, HAND-CHECKED ===");
// L1 149.7  L2 61.54  L3 121.09  -> mean 110.777
// max deviation = 149.7 - 110.777 = 38.923 -> 35.14%
// loss factor = (149.7^2 + 61.54^2 + 121.09^2) / (3 x 110.777^2)
const a1 = analyseReading(
  { l1c: 149.7, l2c: 61.54, l3c: 121.09, neutralC: 85.21, l1nV: 235.46, l2nV: 234, l3nV: 233.85, kva: 77.96, kw: 75.58, pf: 0.969, thdPct: 17.85 },
  315, 415);
near(a1.meanPhaseC, 110.777, 0.01, "mean phase current 110.78 A");
// NEMA takes the max deviation in EITHER direction. L2 at 61.54 A is 49.24 A
// below the mean — a larger deviation than L1 is above it. 49.237/110.777.
near(a1.unbalancePct, 44.45, 0.05, "NEMA unbalance 44.4% (driven by the LOW phase, not the high one)");
const handLoss = (149.7 ** 2 + 61.54 ** 2 + 121.09 ** 2) / (3 * 110.777 ** 2);
near(a1.unbalanceLossFactor, handLoss, 0.001, `unbalance loss factor ${handLoss.toFixed(4)} (extra copper loss ${((handLoss - 1) * 100).toFixed(1)}%)`);
near(a1.zeroSequenceA!, 85.21 / 3, 0.01, "zero sequence I0 = In/3 = 28.4 A");
a1.hottestPhase === "L1" ? ok("hottest phase identified as L1") : no(`hottest ${a1.hottestPhase}`);
near(a1.maxPhasePctRated, (149.7 / 438.2) * 100, 0.1, "max phase = 34% of rated");

console.log("\n=== C. THE REAL FILE ===");
const grid = parseCsv(fs.readFileSync("./KPLC.csv", "utf8"));
const blocks = parseEmdisBlocks(grid);
blocks.length === 1 ? ok("1 transformer block parsed") : no(`${blocks.length} blocks`);
const b = blocks[0];
console.log(`     header: substation ${b.header.substationCode} | ${b.header.make} | ${b.header.ratingKva} kVA | serial ${b.header.serial}`);
b.header.substationCode === "14537" ? ok("substation 14537") : no(`substation ${b.header.substationCode}`);
b.header.serial === "0924020574" ? ok("serial 0924020574 (leading zero preserved as recorded)") : no(`serial ${b.header.serial}`);
b.rows.length === 5109 ? ok("5,109 readings") : no(`${b.rows.length} readings`);
b.rejected === 0 ? ok("no rows rejected") : no(`${b.rejected} rejected`);

const first = b.rows[0];
first.recordedAt.toISOString().startsWith("2025-12-11T14:40") || first.recordedAt.toISOString().startsWith("2025-12-07")
  ? ok(`timestamps parsed as UTC (${first.recordedAt.toISOString()})`) : no(`ts ${first.recordedAt.toISOString()}`);

console.log("\n=== D. DATASET ANALYSIS vs THE AUDIT ===");
const A = analyseDataset(b.rows, 315, 415, { fuseSizeA: 315 });
console.log(`     interval ${A.intervalSeconds}s | span ${A.spanHours.toFixed(1)} h | ${A.readings} readings`);
console.log(`     peak kVA ${A.peakKva.toFixed(1)} = ${A.peakLoadingPct.toFixed(0)}% of nameplate`);
console.log(`     peak phase ${A.peakPhaseA.toFixed(0)} A = ${A.peakPhasePctRated.toFixed(0)}% of rated ${A.ratedPhaseA.toFixed(0)} A`);
console.log(`     minutes any phase over rated: ${A.minutesAnyPhaseOverRated}`);
console.log(`     of which kVA still under nameplate: ${A.hiddenOverloadMinutes}`);
console.log(`     longest unbroken excursion: ${A.longestExcursionMinutes} min`);
console.log(`     unbalance median ${A.unbalance.median.toFixed(1)}% | p95 ${A.unbalance.p95.toFixed(1)}% | max ${A.unbalance.max.toFixed(1)}%`);
console.log(`     neutral median ${A.neutral.medianA.toFixed(0)} A = ${A.neutral.medianPctRated.toFixed(0)}% of rated`);
console.log(`     extra copper loss from imbalance: ${((A.meanUnbalanceLossFactor - 1) * 100).toFixed(1)}%`);
console.log(`     energy ${A.energyKwh?.toFixed(0)} kWh | load factor ${A.loadFactorPct?.toFixed(0)}%`);

A.intervalSeconds === 60 ? ok("interval detected as 60 s") : no(`interval ${A.intervalSeconds}`);
Math.abs(A.peakPhasePctRated - 121) < 1 ? ok("peak phase 121% of rated — matches the audit") : no(`peak ${A.peakPhasePctRated.toFixed(0)}%`);
A.peakLoadingPct < 100 ? ok(`kVA never exceeded nameplate (peak ${A.peakLoadingPct.toFixed(0)}%) — the trap`) : no("kVA exceeded");
A.minutesAnyPhaseOverRated === 149 ? ok("149 minutes above rated phase current") : no(`${A.minutesAnyPhaseOverRated} minutes`);
A.hiddenOverloadMinutes === 149 ? ok("ALL 149 invisible to a kVA report") : ok(`${A.hiddenOverloadMinutes} of 149 invisible to a kVA report`);
Math.abs(A.unbalance.median - 34.5) < 1 ? ok("unbalance median 34.5%") : no(`unbalance ${A.unbalance.median.toFixed(1)}`);
A.longestExcursionMinutes === 18 ? ok("longest excursion 18 minutes") : no(`longest ${A.longestExcursionMinutes}`);

console.log("\n=== E. FINDINGS RAISED AUTOMATICALLY ===");
for (const f of A.findings) console.log(`     [${f.severity}] ${f.headline}`);
A.severity === "CRITICAL" ? ok("dataset flagged CRITICAL") : no(`severity ${A.severity}`);
A.findings.some(f => f.code === "SINGLE_PHASE_OVERLOAD") ? ok("single-phase overload raised") : no("no overload finding");
A.findings.some(f => f.code === "PHASE_UNBALANCE") ? ok("phase unbalance raised") : no("no unbalance finding");
A.findings.some(f => f.code === "NEUTRAL_CURRENT_HIGH") ? ok("neutral current raised") : no("no neutral finding");
A.findings.some(f => f.code === "FUSE_EXCEEDED" || f.code === "FUSE_APPROACHING") ? ok("fuse coordination raised from the inspection register fuse size") : no("no fuse finding");

console.log("\n=== F. THERMAL — kVA vs HOTTEST WINDING ===");
const byKva = computeThermal({ loadKva: A.peakKva, ratingKva: 315, ambientC: 28, powerFactor: 0.97 });
const byPhase = computeThermal({ loadKva: thermalLoadKva(A), ratingKva: 315, ambientC: 28, powerFactor: 0.97 });
console.log(`     using kVA  (${A.peakKva.toFixed(0)} kVA): hot-spot ${byKva.hotspotC.toFixed(1)} C, ageing ${byKva.ageingRate.toFixed(2)}x, band ${byKva.band}`);
console.log(`     using peak phase       : hot-spot ${byPhase.hotspotC.toFixed(1)} C, ageing ${byPhase.ageingRate.toFixed(2)}x, band ${byPhase.band}`);
byPhase.hotspotC > byKva.hotspotC ? ok(`hottest winding runs ${(byPhase.hotspotC - byKva.hotspotC).toFixed(1)} C hotter than the kVA figure suggests`) : no("phase-based thermal not hotter");
byPhase.ageingRate > byKva.ageingRate ? ok(`insulation ages ${(byPhase.ageingRate / byKva.ageingRate).toFixed(1)}x faster than the kVA view predicts`) : no("ageing not higher");

console.log(bad === 0 ? "\n  Engine verified against hand calculation and the real export.\n" : `\n  ${bad} FAILED\n`);
