import { z } from "zod";

/**
 * Every byte entering the system is validated here first.
 *
 * Note the email rule uses an explicit regex rather than Zod's built-in email
 * format. That is deliberate: it behaves identically across Zod versions, and
 * this file must not break when a dependency renames a helper.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address.")
  .max(120, "That email is too long.")
  .regex(EMAIL_RE, "Enter a valid email address.");

/** Exactly six digits. The keypad on the login page can only produce these. */
export const pinField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Your PIN is 6 digits.");

export const loginSchema = z.object({
  email: emailField,
  pin: pinField,
});

export type LoginInput = z.infer<typeof loginSchema>;

// --- Admin: creating users --------------------------------------------------

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Enter the full name.").max(80),
  email: emailField,
  phone: z
    .string()
    .trim()
    .regex(/^(\+254|0)[17]\d{8}$/, "Enter a valid Kenyan number, e.g. 0722123456.")
    .optional()
    .or(z.literal("")),
  staffNumber: z.string().trim().max(20).optional().or(z.literal("")),
  role: z.enum(["ADMIN", "MANAGER", "STORE_KEEPER", "FIELD_ENGINEER"]),
  region: z.string().trim().max(60).optional().or(z.literal("")),
  storeId: z.string().trim().optional().or(z.literal("")),
  pin: pinField,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// --- Shared field types -----------------------------------------------------

/**
 * Kenyan number plates: three letters, three digits, optional trailing letter
 * (KDG 456T, KAA 123A). Normalised to uppercase with no spaces, so "kdg 456t"
 * and "KDG456T" are stored identically and a search finds both.
 */
export const vehiclePlateField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^K[A-Z]{2}\d{3}[A-Z]?$/, "Enter a valid Kenyan plate, e.g. KDG 456T."),
  );

export const kenyanPhoneField = z
  .string()
  .trim()
  .regex(/^(\+254|0)[17]\d{8}$/, "Enter a valid Kenyan number, e.g. 0722123456.");

/** G-Number: G-YYYY-NNNNN. Accepts sloppy input, stores one canonical form. */
export const gNumberField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^G-?\d{4}-?\d{1,6}$/, "G-Number should look like G-2026-01234.")
  .transform((v) => {
    const digits = v.replace(/\D/g, "");
    return `G-${digits.slice(0, 4)}-${digits.slice(4).padStart(5, "0")}`;
  });

// --- Full nameplate fields --------------------------------------------------
// Everything on the plate a KPLC store records, beyond the core electricals.
// All optional: a rusty plate may not be fully legible, and that is honest.
const nameplateFields = {
  frequencyHz: z.coerce.number().int().min(40).max(70).optional().nullable(),
  duty: z.string().trim().max(20).optional().or(z.literal("")),
  standardRef: z.string().trim().max(40).optional().or(z.literal("")),
  hvInsulationLevelKv: z.string().trim().max(20).optional().or(z.literal("")),
  tempRiseOilC: z.coerce.number().int().min(0).max(200).optional().nullable(),
  tempRiseWindingC: z.coerce.number().int().min(0).max(200).optional().nullable(),
  tempClass: z.string().trim().max(5).optional().or(z.literal("")),
  maxAmbientTempC: z.coerce.number().int().min(0).max(80).optional().nullable(),
  insulationOilType: z.string().trim().max(40).optional().or(z.literal("")),
  oilWeightKg: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  totalWeightKg: z.coerce.number().int().min(0).max(200_000).optional().nullable(),
  tapRange: z.string().trim().max(120).optional().or(z.literal("")),
};

// --- Receiving a transformer ------------------------------------------------

export const receiveTransformerSchema = z.object({
  serialNumber: z
    .string()
    .trim()
    .toUpperCase()
    .min(4, "Serial number looks too short.")
    .max(40, "Serial number looks too long."),
  gNumber: gNumberField.optional().or(z.literal("")),
  manufacturerId: z.string().min(1, "Choose the manufacturer."),

  ratingKva: z.coerce
    .number()
    .int("Rating must be a whole number.")
    .positive("Rating must be greater than zero.")
    .max(5000, "That is too large for a distribution transformer."),
  primaryKv: z.coerce.number().positive().max(500),
  secondaryKv: z.coerce.number().positive().max(500),
  phases: z.coerce.number().int().refine((v) => v === 1 || v === 3, "Phases must be 1 or 3."),
  coolingType: z.string().trim().max(20),
  impedancePct: z.coerce.number().min(0).max(30).optional().nullable(),
  vectorGroup: z.string().trim().max(20).optional().or(z.literal("")),
  oilVolumeLitres: z.coerce.number().int().min(0).max(20_000).optional().nullable(),
  yearOfManufacture: z.coerce
    .number()
    .int()
    .min(1950, "That year looks too old to be real.")
    .max(new Date().getFullYear(), "Year cannot be in the future."),

  deliveryNoteRef: z.string().trim().max(60).optional().or(z.literal("")),
  vehiclePlate: vehiclePlateField.optional().or(z.literal("")),
  driverName: z.string().trim().max(80).optional().or(z.literal("")),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  ...nameplateFields,
});

export type ReceiveTransformerInput = z.infer<typeof receiveTransformerSchema>;

/**
 * Onboarding a transformer that is ALREADY on a pole.
 *
 * Deliberately far more permissive than receiving a new unit. A store keeper
 * standing at a roadside pole can read a rating plate from the ground and often
 * nothing else — the serial is on the far side, or corroded away. Demanding a
 * serial number here would simply mean the unit never gets recorded at all,
 * which is exactly the situation this system exists to end.
 *
 * What cannot be waived is position. An onboarded unit has no dispatch or
 * install record, so its coordinates are the only hard fact about it.
 */
export const onboardTransformerSchema = z.object({
  lat: z.coerce
    .number()
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  lng: z.coerce
    .number()
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),

  locationDescription: z
    .string()
    .trim()
    .min(3, "Describe where this is — a road, a landmark, a plot.")
    .max(160),

  gNumber: gNumberField.optional().or(z.literal("")),

  // Blank is a legitimate answer, and a common one.
  serialNumber: z.string().trim().toUpperCase().max(40).optional().or(z.literal("")),

  manufacturerId: z.string().min(1, "Choose the manufacturer, or Unknown."),

  ratingKva: z.coerce
    .number()
    .int()
    .refine((v) => [50, 100, 200, 315, 500, 1000].includes(v), "Choose a standard rating."),

  mountingType: z.enum(["POLE_MOUNTED", "GROUND_MOUNTED", "PAD_MOUNTED", "SUBSTATION"]),

  yearOfManufacture: z.coerce
    .number()
    .int()
    .min(1960, "That year seems too early.")
    .max(new Date().getFullYear(), "That year is in the future.")
    .optional(),

  dataSource: z.enum(["OSM_SURVEYED", "OSM_INFERRED", "MANUAL_PIN"]),

  region: z.string().trim().max(80).optional().or(z.literal("")),
  feeder: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type OnboardTransformerInput = z.infer<typeof onboardTransformerSchema>;

/**
 * Editing an EXISTING transformer's nameplate. Store keeper or admin. This
 * corrects static physical facts about the unit — it never touches a lifecycle
 * event, so the custody chain is untouched. Every edit is audited.
 */
export const editTransformerSchema = z.object({
  ratingKva: z.coerce.number().int().positive().max(5000),
  primaryKv: z.coerce.number().positive().max(500),
  secondaryKv: z.coerce.number().positive().max(500),
  phases: z.coerce.number().int().refine((v) => v === 1 || v === 3, "Phases must be 1 or 3."),
  coolingType: z.string().trim().max(20),
  impedancePct: z.coerce.number().min(0).max(30).optional().nullable(),
  vectorGroup: z.string().trim().max(20).optional().or(z.literal("")),
  oilVolumeLitres: z.coerce.number().int().min(0).max(20_000).optional().nullable(),
  yearOfManufacture: z.coerce.number().int().min(1950).max(new Date().getFullYear()),
  ...nameplateFields,
});

export type EditTransformerInput = z.infer<typeof editTransformerSchema>;

/**
 * Correcting an onboarded transformer after somebody has actually looked at it.
 *
 * Separate from the nameplate edit above because these are IDENTITY and
 * POSITION fields, not plate values — changing them says "the record was wrong
 * about which thing this is, or where". Every one is optional: an engineer who
 * managed to read only the serial should not have to restate everything else.
 *
 * A reason is required. These edits overwrite the only record KPLC has, and
 * "why" is the difference between a correction and a mystery six months later.
 */
export const correctTransformerSchema = z.object({
  locationDescription: z.string().trim().min(3).max(160).optional(),
  serialNumber: z.string().trim().toUpperCase().min(4).max(40).optional(),
  manufacturerId: z.string().min(1).optional(),
  ratingKva: z.coerce
    .number()
    .int()
    .refine((v) => [50, 100, 200, 315, 500, 1000].includes(v), "Choose a standard rating.")
    .optional(),
  mountingType: z.enum(["POLE_MOUNTED", "GROUND_MOUNTED", "PAD_MOUNTED", "SUBSTATION"]).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  reason: z.string().trim().min(4, "Say why this is being corrected.").max(300),
});

export type CorrectTransformerInput = z.infer<typeof correctTransformerSchema>;

// --- Test values ------------------------------------------------------------

const measurement = (max: number) =>
  z.coerce.number().min(0, "Cannot be negative.").max(max).optional().nullable();

export const testValuesSchema = z.object({
  stage: z.enum([
    "STORE_INTAKE",
    "PRE_DISPATCH",
    "SITE_COMMISSIONING",
    "ROUTINE",
    "POST_FAULT",
  ]),
  insulationResistanceHvMohm: measurement(100_000),
  insulationResistanceLvMohm: measurement(100_000),
  turnsRatio: measurement(1000),
  turnsRatioDeviationPct: z.coerce.number().min(-100).max(100).optional().nullable(),
  windingResistanceHvOhm: measurement(10_000),
  windingResistanceLvOhm: measurement(10_000),
  oilBdvKv: measurement(200),
  oilTempC: z.coerce.number().min(-20).max(200).optional().nullable(),
  ambientTempC: z.coerce.number().min(-20).max(70).optional().nullable(),
  polarityOk: z.boolean().optional().nullable(),
  passed: z.boolean(),
  remarks: z.string().trim().max(1000).optional().nullable(),
});

export type TestValuesInput = z.infer<typeof testValuesSchema>;

/**
 * The visual checklist is folded into `remarks` rather than given its own
 * columns. It is qualitative, it changes as KPLC's checklist changes, and six
 * more boolean columns would be six more migrations for no query we ever run.
 */
export const visualChecklistSchema = z.object({
  tankCondition: z.enum(["GOOD", "DAMAGED"]),
  bushings: z.enum(["GOOD", "DAMAGED"]),
  silicaGel: z.enum(["BLUE", "PINK", "WHITE"]),
  oilLevel: z.enum(["NORMAL", "LOW"]),
  nameplateLegible: z.enum(["YES", "NO"]),
});

export type VisualChecklistInput = z.infer<typeof visualChecklistSchema>;

export const intakeTestSchema = z.object({
  values: testValuesSchema,
  visual: visualChecklistSchema,
});

// --- Dispatch ---------------------------------------------------------------

export const dispatchSchema = z.object({
  destination: z.string().trim().min(3, "Where is it going?").max(120),
  region: z.string().trim().min(2, "Choose the region.").max(60),
  county: z.string().trim().max(60).optional().or(z.literal("")),
  vehiclePlate: vehiclePlateField,
  driverName: z.string().trim().min(3, "Enter the driver's name.").max(80),
  driverPhone: kenyanPhoneField.optional().or(z.literal("")),
  expectedArrival: z.coerce.date().optional().nullable(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type DispatchInput = z.infer<typeof dispatchSchema>;

// --- Assigning a G-Number later ---------------------------------------------

export const assignGNumberSchema = z.object({
  gNumber: gNumberField,
});

/** Turns a Zod error into { field: "message" } for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
