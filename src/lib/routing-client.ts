export type LatLng = { lat: number; lng: number };

export type RouteStep = { instruction: string; distanceM: number; durationS: number; name: string };

export type RouteResult = {
  distanceKm: number;
  durationMin: number;
  /** [lat, lng] pairs, ready for a Leaflet Polyline. */
  path: [number, number][];
  steps: RouteStep[];
  source: "road" | "straight-line";
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** A conservative mixed urban/rural driving average, for the straight-line fallback only. */
const AVG_SPEED_KMH = 28;
const CACHE_PREFIX = "tp-route:";

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function cacheKey(origin: LatLng, destination: LatLng): string {
  // Rounded to ~11 m — enough for "the same navigate request", not so coarse
  // that two different transformers a street apart would collide.
  const r = (n: number) => n.toFixed(4);
  return `${CACHE_PREFIX}${r(origin.lat)},${r(origin.lng)}-${r(destination.lat)},${r(destination.lng)}`;
}

function readCache(origin: LatLng, destination: LatLng): RouteResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(origin, destination));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; result: RouteResult };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.result;
  } catch {
    return null;
  }
}

function writeCache(origin: LatLng, destination: LatLng, result: RouteResult): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(origin, destination), JSON.stringify({ at: Date.now(), result }));
  } catch {
    // Storage full or disabled (private browsing) — caching is an optimisation, not a requirement.
  }
}

function straightLineRoute(origin: LatLng, destination: LatLng): RouteResult {
  const distanceKm = haversineKm(origin, destination);
  // +35% over the straight line for real road wander — an honest estimate,
  // never presented as a routed distance.
  const durationMin = ((distanceKm * 1.35) / AVG_SPEED_KMH) * 60;
  return {
    distanceKm,
    durationMin,
    path: [[origin.lat, origin.lng], [destination.lat, destination.lng]],
    steps: [],
    source: "straight-line",
  };
}

type OrsResponse = {
  distance: number;
  duration: number;
  geometry: [number, number][];
  steps: { instruction: string; distance: number; duration: number; name: string }[];
};

export type RouteOutcome = { route: RouteResult; error: string | null };

/**
 * Real turn-by-turn driving directions via our OpenRouteService proxy, with a
 * transparent straight-line fallback. The cache lives in localStorage so a
 * second "Navigate" click on the same pair of points — a very likely thing to
 * do, re-opening a popup — costs nothing against the API's daily quota.
 */
export async function fetchRoute(
  origin: LatLng,
  destination: LatLng,
  opts: { force?: boolean } = {},
): Promise<RouteOutcome> {
  if (!opts.force) {
    const cached = readCache(origin, destination);
    if (cached) return { route: cached, error: null };
  }

  try {
    const res = await fetch("/api/routing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startLat: origin.lat, startLng: origin.lng,
        endLat: destination.lat, endLng: destination.lng,
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      return { route: straightLineRoute(origin, destination), error: body.error ?? "Road routing unavailable." };
    }

    const data = (await res.json()) as OrsResponse;
    const route: RouteResult = {
      distanceKm: data.distance / 1000,
      durationMin: data.duration / 60,
      path: data.geometry.map(([lng, lat]) => [lat, lng] as [number, number]),
      steps: data.steps.map((s) => ({
        instruction: s.instruction, distanceM: s.distance, durationS: s.duration, name: s.name,
      })),
      source: "road",
    };
    writeCache(origin, destination, route);
    return { route, error: null };
  } catch {
    return { route: straightLineRoute(origin, destination), error: "Road routing unavailable." };
  }
}
