import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Put the promoted transformers on the map.
 *
 * The inspection register records a written landmark — "Dagoreti corner at
 * equity", "Wanyee rd", "Showground" — and no coordinates. Nominatim can turn
 * many of those into a point, and the honest description of that point is
 * "somewhere in the right area", not "here is the transformer".
 *
 * So every result is written with positionSource = GEOCODED and an accuracy of
 * 150 m, and the map draws it amber. A geocoded pin and a surveyed pin must
 * never look the same: one says a person stood there, the other says a search
 * engine matched a road name.
 *
 * Run:  npx tsx scripts/geocode-transformers.mts [--limit N] [--dry]
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const CACHE_FILE = path.join(process.cwd(), ".geocode-cache.json");
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy is one request per second from one source. Going
// faster gets the IP blocked, which would end the job for everyone on it.
const RATE_MS = 1100;

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const DRY = args.includes("--dry");

type CacheEntry = { lat: number; lon: number; display: string } | { failed: true };
const cache: Record<string, CacheEntry> = fs.existsSync(CACHE_FILE)
  ? JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
  : {};

const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));

/**
 * Build the query.
 *
 * The landmark alone is useless to a global gazetteer — "Showground" exists in
 * a hundred countries. Anchoring to Nairobi is what makes the search mean
 * anything, and the substation name is often a better landmark than the free
 * text, so both are tried.
 */
function queriesFor(t: { locationNote: string | null; substationName: string | null; substationCode: string | null }): string[] {
  const out: string[] = [];
  const clean = (s: string) =>
    s.replace(/\s+/g, " ").replace(/[^\w\s,'/-]/g, "").trim();

  if (t.locationNote && t.locationNote.length > 2) out.push(clean(t.locationNote));
  if (t.substationName && t.substationName.length > 2) out.push(clean(t.substationName));

  // Deduplicate case-insensitively, drop anything too short to be a place.
  const seen = new Set<string>();
  return out
    .filter((q) => q.length >= 3 && !/^\d+$/.test(q))
    .filter((q) => {
      const k = q.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

async function geocode(query: string): Promise<{ lat: number; lon: number; display: string } | null> {
  const key = query.toLowerCase();
  const hit = cache[key];
  if (hit) return "failed" in hit ? null : hit;

  const url = new URL(NOMINATIM);
  url.searchParams.set("q", `${query}, Nairobi, Kenya`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  // Bound the search to greater Nairobi. Without this, "Karen" happily returns
  // Denmark and the map grows a pin in Scandinavia.
  url.searchParams.set("viewbox", "36.60,-1.10,37.05,-1.50");
  url.searchParams.set("bounded", "1");

  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim requires a real identifying User-Agent. Anonymous traffic
        // is blocked, and rightly so.
        "User-Agent": "TransformerPulse/1.0 (KPLC asset mapping; contact via repository)",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];

    if (!hits.length) {
      cache[key] = { failed: true };
      return null;
    }
    const result = {
      lat: Number(hits[0].lat),
      lon: Number(hits[0].lon),
      display: hits[0].display_name,
    };
    cache[key] = result;
    return result;
  } catch (e) {
    // A network failure is NOT a failed geocode — caching it would poison the
    // cache with a wrong "this address does not exist".
    process.stderr.write(`\n  network error on "${query}": ${e instanceof Error ? e.message : e}\n`);
    return null;
  }
}

/** Greater Nairobi. A result outside this is a match on the wrong continent. */
function withinNairobi(lat: number, lon: number): boolean {
  return lat > -1.50 && lat < -1.10 && lon > 36.60 && lon < 37.05;
}

async function main() {
  const targets = await prisma.transformer.findMany({
    where: { currentLat: null, dataSource: { not: null } },
    select: {
      id: true, gNumber: true, serialNumber: true,
      currentSiteName: true, substationName: true, substationCode: true,
    },
    take: Number.isFinite(LIMIT) ? LIMIT : undefined,
  });

  const alreadyPlaced = await prisma.transformer.count({ where: { currentLat: { not: null } } });

  console.log(`Transformers without coordinates: ${targets.length}`);
  console.log(`Already placed:                   ${alreadyPlaced}`);
  console.log(`Cache holds:                      ${Object.keys(cache).length} previous lookups`);
  console.log(DRY ? "DRY RUN — nothing will be written\n" : "");

  let success = 0, failed = 0, cached = 0, outOfBounds = 0;
  const started = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const queries = queriesFor({
      locationNote: t.currentSiteName,
      substationName: t.substationName,
      substationCode: t.substationCode,
    });

    let placed: { lat: number; lon: number; display: string } | null = null;
    let usedQuery = "";

    for (const q of queries) {
      const wasCached = Boolean(cache[q.toLowerCase()]);
      const hit = await geocode(q);
      if (!wasCached) await new Promise((r) => setTimeout(r, RATE_MS));
      else cached++;

      if (hit && withinNairobi(hit.lat, hit.lon)) { placed = hit; usedQuery = q; break; }
      if (hit) outOfBounds++;
    }

    if (placed) {
      success++;
      if (!DRY) {
        await prisma.transformer.update({
          where: { id: t.id },
          data: {
            currentLat: placed.lat,
            currentLng: placed.lon,
            positionSource: "GEOCODED",
            // Nominatim resolves to a road or a building centroid. 150 m is an
            // honest middle of the 50-200 m range this is good for.
            positionAccuracyM: 150,
            positionSourceText: usedQuery,
          },
        });
      }
    } else {
      failed++;
      if (!DRY) {
        await prisma.transformer.update({
          where: { id: t.id },
          data: { positionSource: "UNAVAILABLE", positionSourceText: queries[0] ?? null },
        });
      }
    }

    if (i % 10 === 0 || i === targets.length - 1) {
      const elapsed = (Date.now() - started) / 1000;
      const rate = (i + 1) / Math.max(1, elapsed);
      const remaining = Math.round((targets.length - i - 1) / Math.max(0.01, rate));
      process.stdout.write(
        `\r  ${i + 1}/${targets.length}  ·  placed ${success}, failed ${failed}  ·  ~${Math.floor(remaining / 60)}m ${remaining % 60}s left   `,
      );
      saveCache();
    }
  }

  saveCache();

  console.log(`\n\nRESULT`);
  console.log(`  placed on the map (GEOCODED)  ${success}`);
  console.log(`  no match, left unplaced       ${failed}`);
  console.log(`  answered from cache           ${cached}`);
  console.log(`  rejected, outside Nairobi     ${outOfBounds}`);
  console.log(`  already had coordinates       ${alreadyPlaced}`);
  console.log(
    `\n  Every pin written here is GEOCODED, accurate to roughly 150 m, and drawn amber.\n` +
    `  It says a search engine matched a landmark, not that anyone stood there.`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  saveCache();
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
