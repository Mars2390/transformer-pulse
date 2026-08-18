import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * IP geolocation, deliberately kept off the request path.
 *
 * The brief asked for ip-api.com on every event. That would put a third-party
 * HTTP call inside the login handler, and it is worth being explicit about
 * what that buys and what it costs:
 *
 *   Latency. Every sign-in waits for a server we do not run. A provider having
 *   a slow morning becomes KPLC field engineers unable to log in.
 *
 *   Availability. The free tier is rate-limited to roughly 45 lookups a
 *   minute. A brute-force attack generates far more events than that, so the
 *   moment you are actually under attack the lookups start failing — and if
 *   the call is inline, the failures are in your auth path.
 *
 *   Privacy. It hands every KPLC user's address to an external company, and
 *   ip-api.com's free endpoint is plain HTTP, so it does so in clear text
 *   across the internet.
 *
 * So events are written immediately with location null, and this backfill
 * fills them in afterwards from an admin-triggered or scheduled call. An
 * analyst opening the dashboard sees countries; nobody waits for them.
 */

const PROVIDER = "https://ipapi.co";
const CACHE_DAYS = 30;

function isPrivate(ip: string): boolean {
  return (
    ip === "unknown" ||
    ip === "::1" ||
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

export type GeoResult = {
  country: string | null;
  city: string | null;
  region: string | null;
  isp: string | null;
  lat: number | null;
  lng: number | null;
};

async function lookup(ip: string): Promise<GeoResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${PROVIDER}/${encodeURIComponent(ip)}/json/`, {
      signal: controller.signal,
      headers: { "User-Agent": "TransformerDNA/1.0 (KPLC asset system)" },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    if (d.error) return null;
    return {
      country: (d.country_name as string) ?? null,
      city: (d.city as string) ?? null,
      region: (d.region as string) ?? null,
      isp: (d.org as string) ?? null,
      lat: typeof d.latitude === "number" ? d.latitude : null,
      lng: typeof d.longitude === "number" ? d.longitude : null,
    };
  } catch {
    return null;
  }
}

/** Cached lookup. Returns null for private ranges rather than asking anybody. */
export async function geolocate(ip: string): Promise<GeoResult | null> {
  if (isPrivate(ip)) return null;

  const cached = await prisma.ipGeoCache.findUnique({ where: { ipAddress: ip } });
  const stale =
    !cached || cached.lookedUpAt.getTime() < Date.now() - CACHE_DAYS * 86_400_000;
  if (cached && !stale) {
    return cached.failed
      ? null
      : { country: cached.country, city: cached.city, region: cached.region, isp: cached.isp, lat: cached.lat, lng: cached.lng };
  }

  const result = await lookup(ip);
  await prisma.ipGeoCache.upsert({
    where: { ipAddress: ip },
    create: { ipAddress: ip, ...(result ?? {}), failed: result === null, lookedUpAt: new Date() },
    update: { ...(result ?? {}), failed: result === null, lookedUpAt: new Date() },
  });
  return result;
}

/**
 * Fills location onto events that do not have it yet.
 *
 * Bounded per run, and it walks distinct addresses rather than distinct events,
 * so a thousand failed logins from one attacker cost one lookup.
 */
export async function backfillLocations(limit = 25): Promise<{ addresses: number; events: number }> {
  const pending = await prisma.securityEvent.findMany({
    where: { country: null, ipAddress: { not: "unknown" } },
    distinct: ["ipAddress"],
    select: { ipAddress: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let events = 0;
  for (const { ipAddress } of pending) {
    if (isPrivate(ipAddress)) {
      const r = await prisma.securityEvent.updateMany({
        where: { ipAddress, country: null },
        data: { country: "Private network", location: "Private network" },
      });
      events += r.count;
      continue;
    }
    const geo = await geolocate(ipAddress);
    if (!geo) continue;
    const label = [geo.city, geo.country].filter(Boolean).join(", ") || null;
    const r = await prisma.securityEvent.updateMany({
      where: { ipAddress, country: null },
      data: { country: geo.country, city: geo.city, isp: geo.isp, location: label },
    });
    events += r.count;
  }

  return { addresses: pending.length, events };
}
