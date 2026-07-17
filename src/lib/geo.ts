/** Geospatial helpers. Kenya bounds and great-circle distance. */

// Rough bounding box of Kenya. Used to reject an obviously wrong fix — a phone
// with no signal often reports 0,0, and Null Island is not in Kakamega.
export const KENYA_BOUNDS = {
  minLat: -4.9,
  maxLat: 5.1,
  minLng: 33.8,
  maxLng: 41.95,
};

export const KENYA_CENTER: [number, number] = [-1.2, 36.9];

export function isWithinKenya(lat: number, lng: number): boolean {
  return (
    lat >= KENYA_BOUNDS.minLat &&
    lat <= KENYA_BOUNDS.maxLat &&
    lng >= KENYA_BOUNDS.minLng &&
    lng <= KENYA_BOUNDS.maxLng
  );
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres between two points. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * A unit scanned this far from its registered site is either a data error or a
 * theft. Either way, a human should look at it.
 */
export const GPS_MISMATCH_THRESHOLD_KM = 2;

export function formatCoords(lat: number, lng: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}
