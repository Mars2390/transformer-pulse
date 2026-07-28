import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";

/**
 * POST /api/routing — turn-by-turn driving directions between two points.
 *
 * Proxies OpenRouteService rather than calling it from the browser: the API
 * key is a shared secret paid for by requests, and putting it in client JS
 * would let anyone who opens devtools spend our quota. Any signed-in user can
 * call this — navigation is not role-restricted the way editing a record is.
 */

const schema = z.object({
  startLat: z.number().finite(),
  startLng: z.number().finite(),
  endLat: z.number().finite(),
  endLng: z.number().finite(),
});

const ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

type OrsStep = { distance: number; duration: number; instruction: string; name: string };
type OrsSegment = { steps?: OrsStep[] };
type OrsFeature = {
  properties?: { summary?: { distance?: number; duration?: number }; segments?: OrsSegment[] };
  geometry?: { coordinates?: [number, number][] };
};

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const { startLat, startLng, endLat, endLng } = schema.parse(await request.json().catch(() => null));

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Road routing is not configured on this server." }, { status: 503 });
    }

    const res = await fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[startLng, startLat], [endLng, endLat]] }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // 429 (rate limit) and 404 (no drivable route between the two points,
      // e.g. one is offshore or off the road network) are the two failure
      // modes worth telling the client apart from "the service is down" — the
      // caller falls back to a straight line either way, but the message differs.
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: res.status === 429 ? "Routing rate limit reached." : "No road route found." , detail: detail.slice(0, 300) },
        { status: res.status === 429 ? 429 : 502 },
      );
    }

    const data = (await res.json()) as { features?: OrsFeature[] };
    const feature = data.features?.[0];
    if (!feature?.geometry?.coordinates?.length) {
      return NextResponse.json({ error: "No road route found." }, { status: 404 });
    }

    const steps = (feature.properties?.segments ?? []).flatMap((segment) =>
      (segment.steps ?? []).map((s) => ({
        instruction: s.instruction,
        distance: s.distance,
        duration: s.duration,
        name: s.name,
      })),
    );

    return NextResponse.json({
      distance: feature.properties?.summary?.distance ?? 0,
      duration: feature.properties?.summary?.duration ?? 0,
      geometry: feature.geometry.coordinates,
      steps,
    });
  } catch (error) {
    return apiError(error);
  }
}
