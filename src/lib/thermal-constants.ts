/**
 * Thermal constants for the IEC 60076-7 steady-state model.
 *
 * WHY THIS FILE EXISTS
 *
 * The thermal engine used to invent its own loss ratio. It derived
 *
 *     R = load loss / no-load loss
 *
 * from two DEFAULTED loss figures (rating x 16 W and rating x 2.4 W), which
 * always produced R = 6.67 no matter which transformer was being modelled.
 * R appears inside the top-oil equation, so a made-up R moves the hot-spot by
 * tens of kelvin. That is not a rounding error, it is a different answer.
 *
 * IEC 60076-7, Table 4, gives the values for a distribution unit with ONAN
 * cooling, and they are now the DEFAULTS rather than the answer:
 *
 *     R  = 5      ratio of load loss to no-load loss at rated current
 *     dOilRated  = 55 K   top-oil rise over ambient at rated load
 *     gRated     = 23 K   hot-spot-to-top-oil gradient at rated load
 *     x  = 0.8    exponent in the OIL rise equation
 *     y  = 1.6    exponent in the WINDING gradient equation
 *
 * Every one of them can now be overridden per transformer from the
 * manufacturer's test certificate. A 315 kVA ABB unit and a 315 kVA Iljin unit
 * are not thermally identical, and their certificates say so.
 *
 * NAMING NOTE, please read before renaming anything
 *
 * The Prisma columns are called windingExponentX and oilExponentY because that
 * is what was specified. IEC 60076-7 uses the letters the other way round: x is
 * the OIL exponent and y is the WINDING exponent. The column names pair each
 * letter with the wrong word, but the VALUES and the equations below follow the
 * standard exactly:
 *
 *     windingExponentX (0.8) -> IEC x -> exponent on the oil-rise ratio
 *     oilExponentY     (1.6) -> IEC y -> exponent on K in the winding gradient
 *
 * If the columns are ever renamed, rename them to oilExponentX and
 * windingExponentY and change only the two lines in fromRecord() below. Do not
 * swap the values; that would silently change every hot-spot in the fleet.
 *
 * hotSpotGradientK is the FULL gradient at rated load, i.e. H x g_r as it is
 * read off the test certificate. There is deliberately no separate hot-spot
 * factor H any more. The old engine multiplied a 23 K gradient by H = 1.1 and
 * reported 25.3 K, which double-counted a factor the certificate had already
 * included.
 */

/** The IEC 60076-7 Table 4 values for an ONAN distribution transformer. */
export const IEC_DEFAULTS = {
  /** R, ratio of load loss to no-load loss at rated current. Dimensionless. */
  lossRatioR: 5,
  /** dOil,r — top-oil rise over ambient at rated load, K. */
  topOilRiseK: 55,
  /** H x g_r — hot-spot-to-top-oil gradient at rated load, K. */
  hotSpotGradientK: 23,
  /** IEC x — exponent on the oil-rise ratio. */
  exponentX: 0.8,
  /** IEC y — exponent on K in the winding gradient. */
  exponentY: 1.6,
} as const;

export type ThermalConstants = {
  lossRatioR: number;
  topOilRiseK: number;
  hotSpotGradientK: number;
  exponentX: number;
  exponentY: number;
};

/**
 * The shape of the Transformer columns this reads. Deliberately structural, so
 * a Prisma row, a partial select or a plain object from a test all satisfy it
 * without importing the generated client into the physics.
 */
export type ThermalConstantsRecord = {
  lossRatioR?: number | null;
  topOilRiseK?: number | null;
  hotSpotGradientK?: number | null;
  windingExponentX?: number | null;
  oilExponentY?: number | null;
};

/**
 * Plausibility windows. A value outside these is not a certificate reading, it
 * is a typing mistake or a unit mix-up, and it is rejected in favour of the IEC
 * default rather than allowed to poison the hot-spot silently.
 */
export const CONSTANT_RANGES = {
  lossRatioR: { min: 0.5, max: 25 },
  topOilRiseK: { min: 20, max: 90 },
  hotSpotGradientK: { min: 5, max: 60 },
  exponentX: { min: 0.2, max: 1.5 },
  exponentY: { min: 0.5, max: 2.5 },
} as const;

export type ConstantOrigin = "record" | "default" | "rejected";

export type ResolvedThermalConstants = {
  constants: ThermalConstants;
  /** Per constant: did it come from the transformer record, or from IEC? */
  origin: Record<keyof ThermalConstants, ConstantOrigin>;
  /** True when at least one value came off the transformer record. */
  anyFromRecord: boolean;
  /** One line an engineer can read on a report to see what was actually used. */
  provenance: string;
};

function take(
  raw: number | null | undefined,
  fallback: number,
  range: { min: number; max: number },
): { value: number; origin: ConstantOrigin } {
  if (raw == null || !Number.isFinite(raw)) return { value: fallback, origin: "default" };
  if (raw < range.min || raw > range.max) return { value: fallback, origin: "rejected" };
  // A stored value identical to the IEC figure is reported as "default", not as
  // a certificate reading. The Prisma columns carry @default(5), @default(55)
  // and so on, so every newly created transformer would otherwise claim to have
  // manufacturer test data it has never been given. The number is the same
  // either way; only the provenance line changes, and that line has to be true.
  if (raw === fallback) return { value: raw, origin: "default" };
  return { value: raw, origin: "record" };
}

/**
 * Read the five constants off a transformer record, falling back to IEC.
 *
 * Null means "the certificate was never keyed in", NOT zero. A zero loss ratio
 * or a zero oil rise would make the model report a cold transformer under any
 * load, which is the most dangerous possible failure mode for this code.
 */
export function resolveThermalConstants(
  record?: ThermalConstantsRecord | null,
): ResolvedThermalConstants {
  const r = take(record?.lossRatioR, IEC_DEFAULTS.lossRatioR, CONSTANT_RANGES.lossRatioR);
  const oil = take(record?.topOilRiseK, IEC_DEFAULTS.topOilRiseK, CONSTANT_RANGES.topOilRiseK);
  const grad = take(record?.hotSpotGradientK, IEC_DEFAULTS.hotSpotGradientK, CONSTANT_RANGES.hotSpotGradientK);
  // See the naming note at the top of this file before touching these two.
  const x = take(record?.windingExponentX, IEC_DEFAULTS.exponentX, CONSTANT_RANGES.exponentX);
  const y = take(record?.oilExponentY, IEC_DEFAULTS.exponentY, CONSTANT_RANGES.exponentY);

  const origin = {
    lossRatioR: r.origin,
    topOilRiseK: oil.origin,
    hotSpotGradientK: grad.origin,
    exponentX: x.origin,
    exponentY: y.origin,
  } as Record<keyof ThermalConstants, ConstantOrigin>;

  const entries = Object.entries(origin) as [keyof ThermalConstants, ConstantOrigin][];
  const fromRecord = entries.filter(([, o]) => o === "record").map(([k]) => k);
  const rejected = entries.filter(([, o]) => o === "rejected").map(([k]) => k);

  let provenance: string;
  if (!fromRecord.length) {
    provenance = "IEC 60076-7 Table 4 defaults (ONAN distribution) — no test-certificate constants on this record.";
  } else if (fromRecord.length === entries.length) {
    provenance = "All five constants from this transformer's test certificate.";
  } else {
    provenance =
      "From test certificate: " + fromRecord.join(", ") + ". IEC default for the rest.";
  }
  if (rejected.length) {
    provenance +=
      " Rejected as out of range and defaulted: " + rejected.join(", ") + ".";
  }

  return {
    constants: {
      lossRatioR: r.value,
      topOilRiseK: oil.value,
      hotSpotGradientK: grad.value,
      exponentX: x.value,
      exponentY: y.value,
    },
    origin,
    anyFromRecord: fromRecord.length > 0,
    provenance,
  };
}

/** The Prisma select an engine needs to read the constants. Import, do not retype. */
export const THERMAL_CONSTANT_SELECT = {
  lossRatioR: true,
  topOilRiseK: true,
  hotSpotGradientK: true,
  windingExponentX: true,
  oilExponentY: true,
} as const;
