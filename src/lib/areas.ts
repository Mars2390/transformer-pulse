/**
 * Nairobi-area buckets for the map's "Area" filter.
 *
 * There is no area/suburb column on a transformer — only a site name, a
 * substation name, and a feeder code, all free text. Rather than add a schema
 * field nobody has populated, an area is matched by scanning that free text
 * for one of these names. It will miss a transformer whose location note
 * never mentions its suburb, which is the honest limit of the approach: the
 * filter can only find what the record actually says.
 */
export const NAIROBI_AREAS = [
  "Westlands", "Parklands", "Kilimani", "Kileleshwa", "Lavington",
  "South B", "South C", "Dagoretti", "Karen", "Langata", "Embakasi",
  "Kasarani", "Ruaraka", "Roysambu", "Starehe", "Kamukunji", "Makadara",
  "Mathare", "Njiru", "Dandora", "Ngong", "Kabiria",
] as const;

export function findArea(...texts: (string | null | undefined)[]): string | null {
  const combined = texts.filter(Boolean).join(" ").toLowerCase();
  for (const area of NAIROBI_AREAS) {
    if (combined.includes(area.toLowerCase())) return area;
  }
  return null;
}
