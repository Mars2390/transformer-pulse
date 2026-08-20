import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { blockContentHash } from "../src/lib/emdis-fingerprint";

/**
 * Give every stored dataset the content fingerprint the importer now writes.
 *
 * Duplicate detection compares fingerprints. Datasets imported before the
 * fingerprint existed have an empty one, and an empty fingerprint matches
 * nothing — so without this, the only duplicates the system can recognise among
 * its existing data are those that happen to share an exact date range, and a
 * re-upload of one of those old files would sail straight through as new data.
 *
 * The hash is computed from the STORED readings, not by re-reading the original
 * file — which is the point. It proves the fingerprint is a property of the
 * measurements themselves, reproducible from the database, and not of a file
 * that may long since have been deleted from somebody's laptop.
 *
 * Writes only EmdisDataset.contentHash. Touches no reading, no rollup, no
 * alert, and no score.
 *
 *   npx tsx scripts/backfill-emdis-hashes.mts            # dry run
 *   npx tsx scripts/backfill-emdis-hashes.mts --apply    # write
 *   npx tsx scripts/backfill-emdis-hashes.mts --apply --all   # rehash everything
 */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
/** Rehash datasets that already have a hash — for verifying reproducibility. */
const ALL = args.includes("--all");

/** Read in pages: a dataset can hold half a million rows. */
const PAGE = 20000;

async function main() {
  const datasets = await prisma.emdisDataset.findMany({
    where: ALL ? {} : { contentHash: "" },
    select: {
      id: true, name: true, contentHash: true,
      substationCode: true, serialAsRecorded: true, readingCount: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!datasets.length) {
    console.log("Every dataset already carries a content fingerprint.");
    return;
  }

  console.log(
    `${APPLY ? "BACKFILL" : "BACKFILL - dry run"}: ${datasets.length} dataset(s) to fingerprint.\n`,
  );

  const byHash = new Map<string, string[]>();
  let changed = 0;
  let confirmed = 0;

  for (const ds of datasets) {
    const rows: Parameters<typeof blockContentHash>[2][number][] = [];
    let skip = 0;
    for (;;) {
      const page = await prisma.emdisReading.findMany({
        where: { datasetId: ds.id },
        orderBy: { id: "asc" },
        skip,
        take: PAGE,
        select: {
          recordedAt: true,
          l1nV: true, l2nV: true, l3nV: true,
          l1c: true, l2c: true, l3c: true, neutralC: true,
          l1l2V: true, l2l3V: true, l3l1V: true,
          kva: true, kw: true, kvar: true, pf: true, hz: true, thdPct: true, kwh: true,
        },
      });
      if (!page.length) break;
      skip += page.length;
      rows.push(...page);
    }

    const hash = blockContentHash(ds.substationCode, ds.serialAsRecorded, rows);
    const list = byHash.get(hash) ?? [];
    list.push(`${ds.name} (${ds.substationCode ?? "-"})`);
    byHash.set(hash, list);

    if (ds.contentHash && ds.contentHash !== hash) {
      console.log(`  ! ${ds.name}: stored hash disagrees with a fresh one — readings changed since import`);
      changed++;
    } else if (ds.contentHash === hash) {
      confirmed++;
    }

    console.log(
      `  ${hash.slice(0, 12)}  ${ds.name}  ${rows.length.toLocaleString()} rows` +
        (rows.length !== ds.readingCount ? `  (readingCount says ${ds.readingCount.toLocaleString()})` : ""),
    );

    if (APPLY && ds.contentHash !== hash) {
      await prisma.emdisDataset.update({ where: { id: ds.id }, data: { contentHash: hash } });
    }
  }

  const collisions = [...byHash.entries()].filter(([, names]) => names.length > 1);
  console.log("");
  if (collisions.length) {
    console.log(`${collisions.length} group(s) of datasets hold byte-identical readings:`);
    for (const [hash, names] of collisions) {
      console.log(`  ${hash.slice(0, 12)}  ${names.length} copies: ${names.join(", ")}`);
    }
  } else {
    console.log("No two datasets hold identical readings.");
  }

  if (ALL) console.log(`\n${confirmed} hash(es) reproduced exactly; ${changed} disagreed.`);
  if (!APPLY) console.log("\nDry run - nothing written. Re-run with --apply.");
}

await main();
await prisma.$disconnect();
