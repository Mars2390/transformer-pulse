import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { snapshotMetricsFor } from "../src/lib/snapshot-reading";
import { verifySnapshot, formatVerifyReport } from "../src/lib/analysis-verify";
import { computeThermal, ageingRateAt } from "../src/lib/transformer-thermal";
import { lifeFromAgeing } from "../src/lib/time-to-failure";

/**
 * Prove one transformer's snapshot by hand.
 *
 * Prints, side by side, the figure the system stored and the same figure
 * recomputed longhand from the raw meter reading — rated phase current, NEMA
 * unbalance, loading, the IEC 60076-7 top-oil and hot-spot equations, and the
 * ageing rate — with the formula printed beside each row.
 *
 * The point is not that the numbers agree. It is that an engineer who does not
 * trust the system can take this sheet, a calculator and the standard, and
 * settle it in ten minutes. A figure nobody can check by hand is a figure
 * nobody has to believe.
 *
 *   npx tsx scripts/verify-snapshot.mts 153457
 *   npx tsx scripts/verify-snapshot.mts            # every transformer with data
 */

const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));

const targets = arg
  ? await prisma.transformer.findMany({
      where: { gNumber: arg.replace(/^G-/i, "") },
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true },
    })
  : await prisma.transformer.findMany({
      where: { emdisDatasets: { some: { staged: false } } },
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true },
    });

if (!targets.length) {
  console.log(arg ? `No transformer G-${arg}.` : "No transformer has load data yet.");
  process.exit(0);
}

let checked = 0;
let mismatched = 0;

for (const tx of targets) {
  const label = tx.gNumber ? `G-${tx.gNumber}` : tx.serialNumber;
  const s = await snapshotMetricsFor(tx.id, tx.ratingKva);
  if (!s) continue;

  const report = verifySnapshot(
    {
      label,
      l1A: s.l1c, l2A: s.l2c, l3A: s.l3c,
      neutralA: s.neutralC,
      kva: s.kva,
      ratingKva: s.ratingKva,
      voltLL: s.voltLL,
      ambientC: s.ambientC,
    },
    s,
  );

  checked++;
  if (!report.allOk) mismatched++;

  // One transformer: print the whole sheet. A fleet: print the verdict only,
  // then the failures — 37 full tables is not a report, it is a haystack.
  if (targets.length === 1) {
    console.log(formatVerifyReport(report));

    // The hot-spot rows above are on the kVA basis, which is what a
    // conventional report shows. The winding the paper is actually in runs
    // hotter, and on an unbalanced unit the gap is the entire finding.
    const byPhase = computeThermal({
      loadKva: (s.maxPhasePctRated / 100) * s.ratingKva,
      ratingKva: s.ratingKva,
      ambientC: s.ambientC,
      constants: s.constants,
      powerFactor: s.pf ?? 0.95,
    });
    console.log("");
    console.log("HOTTEST WINDING — the figure a limit and an ageing rate are judged on");
    console.log(
      `  K = I_max / I_rated = ${s.maxPhaseA.toFixed(1)} / ${s.ratedPhaseA.toFixed(1)} = ` +
        `${(s.maxPhasePctRated / 100).toFixed(4)}   (phase ${s.hottestPhase ?? "?"})`,
    );
    console.log(
      `  hot-spot = ${s.ambientC} + ${byPhase.topOilRiseK.toFixed(4)} + ` +
        `${byPhase.hotspotRiseK.toFixed(4)} = ${byPhase.hotspotC.toFixed(4)} degC` +
        `   [system ${s.hotSpotByPhaseC.toFixed(4)}]`,
    );
    console.log(
      `  ageing   = 2^((${byPhase.hotspotC.toFixed(4)} - 98) / 6) = ` +
        `${ageingRateAt(byPhase.hotspotC).toFixed(4)}x` +
        `   [system ${s.ageingRateByPhase.toFixed(4)}x]`,
    );
    console.log(
      `  life     = 30 y / ${s.ageingRateByPhase.toFixed(2)}x = ` +
        `${lifeFromAgeing(s.ageingRateByPhase).yearsToEndOfLife.toFixed(3)} y`,
    );
    console.log(
      `  band     = ${byPhase.band}` +
        `   (the kVA basis alone reads ${s.hotSpotC.toFixed(2)} degC, ${s.thermalBand})`,
    );

    const gap = Math.abs(byPhase.hotspotC - s.hotSpotByPhaseC);
    if (gap > 0.005) {
      console.log(`  MISMATCH: longhand and system differ by ${gap.toFixed(4)} K`);
      mismatched++;
    }
  } else if (!report.allOk) {
    console.log(`${label}: ${report.failures.length} row(s) disagree`);
    for (const f of report.failures) {
      console.log(`   ${f.quantity}: manual ${f.manual.toFixed(4)}, system ${f.system.toFixed(4)} ${f.unit}`);
    }
  }
}

console.log("");
console.log(
  mismatched === 0
    ? `${checked} snapshot(s) verified longhand. Every figure matches.`
    : `${checked} snapshot(s) checked, ${mismatched} DISAGREE.`,
);
if (mismatched) process.exitCode = 1;

await prisma.$disconnect();
