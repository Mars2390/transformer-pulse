/**
 * Harvest candidate transformer sites in Nairobi from OpenStreetMap.
 *
 * Writes a CSV that the existing bulk importer at /store/import accepts, so
 * nothing here touches the database directly — you review the file first, and
 * every unit enters through the same audited path as a real one.
 *
 * Two tiers, and the CSV records which tier every row came from:
 *
 *   SURVEYED  — OSM has a mapped power asset at this exact point
 *               (power=transformer / substation / pole). Someone stood there.
 *               Coordinate accuracy: a few metres.
 *
 *   INFERRED  — a named site (mall, hospital, school, market) that is certainly
 *               fed by a distribution transformer, placed at the site's own
 *               coordinate. The site is real and the inference is sound; the
 *               transformer's exact position within the plot is not known.
 *               Coordinate accuracy: 20-80 m.
 *
 * Transmission assets are excluded. A 220 kV grid substation is not a
 * distribution transformer, and putting one on the map as a 200 kVA unit is the
 * kind of error a KPLC engineer spots immediately.
 *
 * Usage:  npx tsx scripts/harvest-osm-sites.mts > nairobi-sites.csv
 */

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

/** The six areas, with the radius that counts as "in" this area. */
const AREAS: [string, number, number][] = [
  ["Westlands", -1.2650, 36.8030],
  ["Parklands", -1.2620, 36.8180],
  ["Kilimani", -1.2900, 36.7850],
  ["Upper Hill", -1.2960, 36.8130],
  ["South B", -1.3120, 36.8320],
  ["South C", -1.3230, 36.8280],
];
const AREA_RADIUS_KM = 2.2;

const BBOX = "-1.345,36.760,-1.250,36.855";

// Set OSM_CACHE_DIR to reuse an earlier pull instead of hitting Overpass again.
const CACHE = process.env.OSM_CACHE_DIR ?? "";
const CACHE_POWER = CACHE ? `${CACHE}/osm.json` : undefined;
const CACHE_ANCHORS = CACHE ? `${CACHE}/anchors.json` : undefined;

type El = {
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** Overpass is a free public service and is regularly overloaded. Be patient
 *  and try the mirrors rather than hammering one host. */
async function overpass(query: string, cacheFile?: string): Promise<El[]> {
  // Overpass is free and frequently overloaded — mirrors go down for minutes at
  // a time. A successful pull is cached so a later run costs nothing and works
  // offline, which matters the morning of a demo.
  const fs = await import("node:fs");
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    process.stderr.write(`  using cached ${cacheFile} (${cached.elements.length} elements)\n`);
    return cached.elements ?? [];
  }

  for (const ep of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          body: query,
          signal: AbortSignal.timeout(180_000),
        });
        const text = await res.text();
        if (!text.trimStart().startsWith("{")) {
          // An HTML body is Overpass reporting an error, not data.
          process.stderr.write(`  ${ep} attempt ${attempt + 1}: server busy\n`);
          await new Promise((r) => setTimeout(r, 30_000));
          continue;
        }
        if (cacheFile) fs.writeFileSync(cacheFile, text);
        return JSON.parse(text).elements ?? [];
      } catch (e) {
        process.stderr.write(`  ${ep} attempt ${attempt + 1}: ${String(e).slice(0, 60)}\n`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  }
  throw new Error("Every Overpass endpoint failed. Try again in a few minutes.");
}

const km = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const R = 6371, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const nearestArea = (lat: number, lon: number) => {
  let best: string | null = null, bestD = Infinity;
  for (const [name, aLat, aLon] of AREAS) {
    const d = km(lat, lon, aLat, aLon);
    if (d < bestD) { bestD = d; best = name; }
  }
  return { area: best!, distanceKm: bestD };
};

/** Distribution transformers come in standard ratings. Pick by what the site
 *  plausibly draws — a hospital is not a street-corner pole-mount. */
function ratingFor(kind: string): number {
  if (/hospital|university|mall/.test(kind)) return 1000;
  if (/college|marketplace|industrial/.test(kind)) return 500;
  if (/school|fuel/.test(kind)) return 200;
  return 315;
}

type Site = {
  tier: "SURVEYED" | "INFERRED";
  name: string;
  lat: number;
  lon: number;
  area: string;
  ratingKva: number;
  source: string;
};

async function main() {
  const sites: Site[] = [];
  const seen = new Set<string>();

  // --- Tier 1: real mapped power assets ------------------------------------
  process.stderr.write("Tier 1 — surveyed power assets...\n");
  const power = await overpass(`[out:json][timeout:120];
(
  node["power"](${BBOX});
  way["power"](${BBOX});
);
out center tags;`, CACHE_POWER);

  for (const el of power) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const t = el.tags ?? {};
    if (lat == null || lon == null) continue;
    if (!["transformer", "substation", "pole"].includes(t.power ?? "")) continue;

    // Exclude transmission — wrong class of asset entirely.
    if (/220000|132000|66000/.test(t.voltage ?? "")) continue;
    if (/transmission/i.test(t.substation ?? "")) continue;

    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { area, distanceKm } = nearestArea(lat, lon);
    if (distanceKm > AREA_RADIUS_KM) continue;

    sites.push({
      tier: "SURVEYED",
      name: t.name ?? `${area} distribution point`,
      lat, lon, area,
      ratingKva: /substation/.test(t.power!) ? 500 : 200,
      source: `OSM power=${t.power}`,
    });
  }
  process.stderr.write(`  ${sites.length} surveyed assets in the six areas\n`);

  // --- Tier 2: named sites that certainly have one -------------------------
  process.stderr.write("Tier 2 — named service points...\n");
  const anchors = await overpass(`[out:json][timeout:120];
(
  node["amenity"](${BBOX});
  way["amenity"](${BBOX});
  node["shop"="mall"](${BBOX});
  way["shop"="mall"](${BBOX});
);
out center tags;`, CACHE_ANCHORS);

  const WANTED = /^(hospital|clinic|university|college|school|marketplace|fuel|bank|police|fire_station)$/;
  for (const el of anchors) {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const t = el.tags ?? {};
    const name = t.name;
    if (lat == null || lon == null || !name) continue;

    const kind = t.amenity ?? t.shop ?? "";
    if (!WANTED.test(kind) && t.shop !== "mall") continue;
    if (seen.has(name)) continue;

    const { area, distanceKm } = nearestArea(lat, lon);
    if (distanceKm > AREA_RADIUS_KM) continue;

    // Do not stack an inferred site on top of an asset already surveyed.
    if (sites.some((s) => km(s.lat, s.lon, lat, lon) < 0.08)) continue;

    seen.add(name);
    sites.push({
      tier: "INFERRED",
      name,
      lat, lon, area,
      ratingKva: ratingFor(kind),
      source: `OSM ${t.shop === "mall" ? "shop=mall" : `amenity=${kind}`}`,
    });
  }
  process.stderr.write(`  ${sites.length} total candidate sites\n`);

  // Spread across the six areas rather than 40 in whichever is best mapped.
  const perArea = new Map<string, Site[]>();
  for (const s of sites) {
    if (!perArea.has(s.area)) perArea.set(s.area, []);
    perArea.get(s.area)!.push(s);
  }
  // Surveyed first inside each area — they are the better data.
  for (const list of perArea.values()) {
    list.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "SURVEYED" ? -1 : 1));
  }

  const chosen: Site[] = [];
  const TARGET = 50;
  let round = 0;
  while (chosen.length < TARGET) {
    let added = false;
    for (const [, list] of perArea) {
      if (list[round]) { chosen.push(list[round]); added = true; }
      if (chosen.length >= TARGET) break;
    }
    if (!added) break;
    round++;
  }

  for (const [area, list] of perArea) {
    const c = chosen.filter((s) => s.area === area);
    process.stderr.write(
      `  ${area.padEnd(11)} ${String(c.length).padStart(2)} chosen of ${list.length} ` +
      `(${c.filter((s) => s.tier === "SURVEYED").length} surveyed)\n`,
    );
  }
  process.stderr.write(`\n${chosen.length} sites written. `);
  if (chosen.length < TARGET) {
    process.stderr.write(`SHORT of ${TARGET} — OSM has no more in these areas.\n`);
  } else {
    process.stderr.write("\n");
  }

  // --- CSV for the existing bulk importer ----------------------------------
  const q = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Serial Number", "Rating kVA", "Manufacturer", "Year", "Status",
    "Site Name", "Latitude", "Longitude", "Region", "Data Source", "Position Basis",
  ];
  console.log(header.join(","));
  chosen.forEach((s, i) => {
    console.log([
      q(`OSM-${String(i + 1).padStart(4, "0")}`),
      s.ratingKva,
      q("Unspecified"),
      2020,
      "IN_FIELD",
      q(s.name),
      s.lat.toFixed(6),
      s.lon.toFixed(6),
      q(`Nairobi — ${s.area}`),
      q(s.source),
      q(s.tier === "SURVEYED" ? "Surveyed asset position" : "Site centroid, transformer inferred"),
    ].join(","));
  });
}

main().catch((e) => { process.stderr.write(String(e) + "\n"); process.exit(1); });
