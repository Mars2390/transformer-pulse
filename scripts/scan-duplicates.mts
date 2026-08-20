import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { scanStoredDuplicates, flagStoredDuplicates, collapseRedundantAlerts } from "../src/lib/emdis-duplicates";

/**
 * Find the duplicate load datasets already in the register, and flag them.
 *
 * The same scan the "Scan for duplicates" button runs, available from a
 * terminal — for a scheduled check, or for looking at the register before
 * anyone has a browser open.
 *
 * It flags. It never deletes. Which copy of a real measurement to keep is a
 * decision that should have a name attached to it, and a nightly job that
 * quietly removed load history would be a worse bug than the one it fixed.
 *
 *   npx tsx scripts/scan-duplicates.mts                    # report only
 *   npx tsx scripts/scan-duplicates.mts --apply            # report and flag
 *   npx tsx scripts/scan-duplicates.mts --collapse-alerts  # also remove repeated alerts
 */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
/** Remove alert rows that repeat a finding word for word. Keeps one of each. */
const COLLAPSE = args.includes("--collapse-alerts");

const scan = APPLY ? await flagStoredDuplicates() : await scanStoredDuplicates();

console.log(`Scanned ${scan.totals.datasets} dataset(s).\n`);

if (!scan.duplicates.length) {
  console.log("No duplicates. Every reading in the system is counted exactly once.");
} else {
  for (const d of scan.duplicates) {
    console.log(`  [${d.kind}] ${d.name}`);
    console.log(`      ${d.transformerLabel ? `G-${d.transformerLabel}` : "unmatched"} · ${d.readingCount.toLocaleString()} readings · ${d.firstReadingAt.toISOString().slice(0, 10)} to ${d.lastReadingAt.toISOString().slice(0, 10)}`);
    console.log(`      keeper: ${d.keeper.name} (imported ${d.keeper.createdAt.toISOString().slice(0, 10)})`);
    console.log(`      ${d.reason}`);
    console.log("");
  }

  console.log(
    `${scan.totals.identical} exact · ${scan.totals.sameRange} same-window · ${scan.totals.overlap} overlapping`,
  );
  console.log(
    `${scan.totals.redundantReadings.toLocaleString()} readings are held twice. Every figure built by ` +
      `adding up — minutes over rated current, total readings — is inflated for the affected transformers ` +
      `until the copies are deleted. Peaks and averages are unaffected.`,
  );
}

if (scan.redundantAlerts.length) {
  console.log(`\n${scan.totals.redundantAlerts} alert row(s) repeat a finding word for word:\n`);
  for (const g of scan.redundantAlerts) {
    console.log(`  x${g.dropIds.length + 1}  ${g.transformerLabel}  ${g.type}`);
    console.log(`        ${g.message.slice(0, 140)}`);
  }
  if (COLLAPSE) {
    const { groups, removed } = await collapseRedundantAlerts();
    console.log(`\n  Collapsed ${groups} group(s), removed ${removed} redundant alert row(s). One of each kept.`);
  } else {
    console.log("\n  Re-run with --collapse-alerts to remove the repeats, keeping one of each.");
  }
} else {
  console.log("\nNo alert says the same thing twice.");
}

console.log(APPLY ? "\nFlags written." : "\nReport only - re-run with --apply to flag them in the register.");

await prisma.$disconnect();
