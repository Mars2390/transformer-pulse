/**
 * Rendering quantities that were never measured.
 *
 * The validation layer now stops blank form boxes from being stored as zero
 * (see `blankToNull` in validation.ts). This is the other half: rows already in
 * the database were written before that fix, and they still hold 0 kg, 0 °C and
 * 0/0 temperature rises that nobody ever typed.
 *
 * Cleaning those up is a data job. Refusing to PRESENT them as findings is a
 * code job, and it is the one that has to happen first, because "0 kg" on a
 * dossier is read by a person as a measurement. The same principle as the
 * nameplate parser refusing to fill a blank impedance row with 4.5: an absence
 * must never be dressed up as a value.
 */

/**
 * Quantities where zero is physically impossible on a working transformer, so a
 * stored zero is a blank in disguise.
 *
 * Deliberately NOT a general "falsy means missing" rule. Temperature readings,
 * ratio deviations and counts can legitimately be zero, and blanking those
 * would be the same class of lie in the opposite direction.
 */
export function measured(n: number | null | undefined): number | null {
  if (n == null) return null;
  if (!Number.isFinite(n)) return null;
  return n > 0 ? n : null;
}

/** `unit(2200, "kg")` → "2200 kg"; `unit(0, "kg")` → null. */
export function unit(n: number | null | undefined, suffix: string): string | null {
  const v = measured(n);
  return v == null ? null : `${v} ${suffix}`;
}

/**
 * "60/65 °C", "60/— °C", or null when neither figure exists.
 *
 * A pair is only worth printing when at least one half is real. "0/0 °C" was
 * the worst offender on the story page: two absences rendered as a spec.
 */
export function pair(a: number | null | undefined, b: number | null | undefined, suffix: string): string | null {
  const x = measured(a);
  const y = measured(b);
  if (x == null && y == null) return null;
  return `${x ?? "—"}/${y ?? "—"} ${suffix}`;
}
