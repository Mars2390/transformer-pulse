import { z } from "zod";

/**
 * Every byte entering the system is validated here first.
 *
 * Note the email rule uses an explicit regex rather than Zod's built-in email
 * format. That is deliberate: it behaves identically across Zod versions, and
 * this file must not break when a dependency renames a helper.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * A blank box is NOT a zero.
 *
 * `z.coerce.number()` runs `Number(value)`, and `Number("")` is 0. An HTML form
 * always posts every field, so an untouched "Oil weight (kg)" box arrives as
 * "" and lands in the database as 0. That is where "0 kg", "0/0 °C" and
 * "0 °C max ambient" on the story page came from: nobody typed them, and no
 * transformer on earth weighs nothing.
 *
 * On the nameplate that is embarrassing. On a test sheet it is dangerous — a
 * blank oil BDV box would be stored as 0 kV, which reads as complete dielectric
 * failure, and a blank insulation resistance as 0 MΩ, a dead short. The health
 * score would then act on a reading that was never taken.
 *
 * So every optional number goes through this first. Empty, whitespace, "-",
 * "N/A" and "null" all mean the same thing — nobody wrote anything down — and
 * they all become null, which the whole app already renders as "—".
 */
const BLANK = /^(|-|--|—|n\/?a|nil|none|null|undefined)$/i;

export function blankToNull<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string" && BLANK.test(v.trim())) return null;
    if (typeof v === "number" && Number.isNaN(v)) return null;
    return v;
  }, schema);
}

/** An optional measured quantity: blank stays blank, and zero is not invented. */
const optionalNumber = (opts: { min?: number; max: number; int?: boolean }) => {
  let n = z.coerce.number();
  if (opts.int) n = n.int();
  if (opts.min !== undefined) n = n.min(opts.min);
  return blankToNull(n.max(opts.max).nullable().optional());
};

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
  // Hand-listed once, and that list went stale the moment STORE_MANAGER was
  // added — the dropdown would have offered it and the API would have refused
  // it, which is the most confusing possible pairing. Zod needs a literal
  // tuple, so this cannot be derived; instead it carries every member and a
  // note that the enum in schema.prisma is the source of truth.
  role: z.enum(["ADMIN", "MANAGER", "STORE_MANAGER", "STORE_KEEPER", "FIELD_ENGINEER"]),
  region: z.string().trim().max(60).optional().or(z.literal("")),
  storeId: z.string().trim().optional().or(z.literal("")),
  pin: pinField,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Kenyan number plates: three letters, three digits, one trailing letter —
 * seven characters, KDA 123A. Spaces and hyphens are how people write them, not
 * part of the plate, so they are stripped before counting and the stored form is
 * always the seven characters.
 *
 * The trailing letter is now REQUIRED where it used to be optional. A six-
 * character plate was accepted and then never matched the vehicle it was typed
 * for, because current civilian series all carry it. GK and diplomatic plates do
 * not follow this pattern; if those ever enter the fleet this rule needs a branch,
 * not a loosening.
 */
export const vehiclePlateField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(
    z
      .string()
      .length(
        7,
        "A number plate is 7 characters — 3 letters, 3 digits, 1 letter, e.g. KDA 123A. Spaces don't count.",
      )
      .regex(/^K[A-Z]{2}\d{3}[A-Z]$/, "That isn't a Kenyan plate. It should read like KDA 123A."),
  );

/**
 * A Kenyan mobile number is ten digits: 0 then 7 or 1 then eight more.
 *
 * +254 is the same number written for an international dialler, so it is folded
 * to the local form rather than rejected — a driver reading his own phone back
 * often reads the +254. One stored shape means a search finds the number however
 * it was typed.
 */
export const kenyanPhoneField = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^\+?254/, "0"))
  .pipe(
    z
      .string()
      .length(10, "A phone number is 10 digits, e.g. 0722123456. You have entered too many.")
      .regex(/^0[17]\d{8}$/, "That isn't a Kenyan mobile number. It starts 07 or 01, e.g. 0722123456."),
  );

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

// Everything on the plate a KPLC store records, beyond the core electricals.
// All optional: a rusty plate may not be fully legible, and that is honest.
const nameplateFields = {
  frequencyHz: optionalNumber({ min: 40, max: 70, int: true }),
  duty: z.string().trim().max(20).optional().or(z.literal("")),
  standardRef: z.string().trim().max(40).optional().or(z.literal("")),
  hvInsulationLevelKv: z.string().trim().max(20).optional().or(z.literal("")),
  // Minimums are 1, not 0. A temperature RISE of zero and a weight of zero are
  // not readings anyone takes; they are the shape a blank box used to arrive in.
  tempRiseOilC: optionalNumber({ min: 1, max: 200, int: true }),
  tempRiseWindingC: optionalNumber({ min: 1, max: 200, int: true }),
  tempClass: z.string().trim().max(5).optional().or(z.literal("")),
  maxAmbientTempC: optionalNumber({ min: 1, max: 80, int: true }),
  insulationOilType: z.string().trim().max(40).optional().or(z.literal("")),
  oilWeightKg: optionalNumber({ min: 1, max: 100_000, int: true }),
  totalWeightKg: optionalNumber({ min: 1, max: 200_000, int: true }),
  tapRange: z.string().trim().max(120).optional().or(z.literal("")),

  // IEC 60076-7 thermal constants, from the test certificate. Optional, and
  // blank genuinely means blank — the engine falls back to the IEC Table 4
  // value and says so on the report.
  //
  // The bounds are CONSTANT_RANGES from thermal-constants.ts, restated rather
  // than imported because this file is the boundary and must not depend on the
  // physics. They are plausibility windows, not precision: a value outside them
  // is a unit mix-up or a typing slip, and the resolver rejects it in favour of
  // the default rather than letting it poison a hot-spot silently.
  lossRatioR: optionalNumber({ min: 0.5, max: 25 }),
  topOilRiseK: optionalNumber({ min: 20, max: 90 }),
  hotSpotGradientK: optionalNumber({ min: 5, max: 60 }),
  windingExponentX: optionalNumber({ min: 0.2, max: 1.5 }),
  oilExponentY: optionalNumber({ min: 0.5, max: 2.5 }),
};

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
  impedancePct: optionalNumber({ min: 0.5, max: 30 }),
  vectorGroup: z.string().trim().max(20).optional().or(z.literal("")),
  oilVolumeLitres: optionalNumber({ min: 1, max: 20_000, int: true }),
  yearOfManufacture: z.coerce
    .number()
    .int()
    .min(1950, "That year looks too old to be real.")
    .max(new Date().getFullYear(), "Year cannot be in the future."),

  deliveryNoteRef: z.string().trim().max(60).optional().or(z.literal("")),
  vehiclePlate: vehiclePlateField.optional().or(z.literal("")),
  driverName: z.string().trim().max(80).optional().or(z.literal("")),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  fatReportUrl: z.string().url().optional().or(z.literal("")),
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
 * A FIELD ENGINEER onboarding an existing transformer, standing under it.
 *
 * Same premise as onboardTransformerSchema above, different evidence. The store
 * version is somebody at a desk dropping a pin on a map; this is somebody with
 * the unit in front of them and a GPS fix in their pocket. That difference is
 * why these are two schemas rather than one with optional halves:
 *
 *   - Coordinates come from the device, not a click, so accuracyM is part of
 *     the record and the position is SURVEYED rather than estimated.
 *   - A substation number is REQUIRED. A field engineer always knows which
 *     substation they are working on, and it is the one fact that lets an
 *     orphan pole-top unit join the rest of the network. The desk flow cannot
 *     demand it, because whoever is clicking the map often does not know.
 *   - Photographs are accepted, because someone is there to take them.
 *
 * Everything the engineer cannot read from the ground stays optional. Demanding
 * a serial number off a corroded plate is how a unit ends up never recorded.
 */
export const fieldOnboardSchema = z.object({
  lat: z.coerce
    .number()
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  lng: z.coerce
    .number()
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),

  /** Metres of GPS uncertainty as the device reported it. */
  accuracyM: z.coerce.number().int().min(0).max(10000).optional(),

  /**
   * How the position was obtained. A device fix and a typed pair of numbers
   * are both coordinates and they are NOT the same evidence, so the record
   * keeps them apart: only GPS earns positionSource SURVEYED and a verifiedAt
   * stamp. Typing coordinates is allowed - a handheld unit, a reading called
   * in over the radio, a phone whose GPS will not lock under a canopy - but
   * the record says so rather than quietly promoting a guess.
   */
  positionMethod: z.enum(["GPS", "MANUAL"]).default("GPS"),

  // The substation is the link into the rest of the network, so it is the one
  // piece of free text that cannot be skipped.
  substationCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Enter the substation number — you are standing on it.")
    .max(40),
  substationName: z.string().trim().max(120).optional().or(z.literal("")),

  locationDescription: z
    .string()
    .trim()
    .min(3, "Describe where this is — a road, a landmark, a plot.")
    .max(160),

  gNumber: gNumberField.optional().or(z.literal("")),
  serialNumber: z.string().trim().toUpperCase().max(40).optional().or(z.literal("")),

  manufacturerId: z.string().min(1, "Choose the manufacturer, or Unknown."),

  ratingKva: z.coerce
    .number()
    .int()
    .refine((v) => [50, 100, 200, 315, 500, 1000].includes(v), "Choose a standard rating."),

  yearOfManufacture: z.coerce
    .number()
    .int()
    .min(1960, "That year seems too early.")
    .max(new Date().getFullYear(), "That year is in the future.")
    .optional(),

  photoUrls: z.array(z.string().min(1)).max(5).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type FieldOnboardInput = z.infer<typeof fieldOnboardSchema>;

/**
 * The CHECKER half of maker-checker: accepting or refusing booked-in units.
 *
 * Bulk by design - a checker facing a delivery of forty units should not click
 * forty times - but a rejection reason is required, and one reason covers the
 * whole call. Rejecting a mixed batch for different reasons is two calls, which
 * is the honest shape: a reason that applies to everything or nothing.
 */
export const approvalDecisionSchema = z
  .object({
    transformerIds: z
      .array(z.string().min(1))
      .min(1, "Select at least one transformer.")
      .max(200, "Approve at most 200 at a time."),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(300).optional().or(z.literal("")),
  })
  .refine((v) => v.decision !== "REJECT" || (v.reason && v.reason.trim().length >= 3), {
    message: "Say why it is being rejected. A rejection with no reason cannot be acted on.",
    path: ["reason"],
  });

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

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
  impedancePct: optionalNumber({ min: 0.5, max: 30 }),
  vectorGroup: z.string().trim().max(20).optional().or(z.literal("")),
  oilVolumeLitres: optionalNumber({ min: 1, max: 20_000, int: true }),
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

/**
 * A test reading that was actually taken.
 *
 * The minimum is deliberately above zero. Zero megohms is a dead short, zero kV
 * breakdown voltage is oil that conducts, and a turns ratio of zero is not a
 * transformer — none of these are readings an instrument produces on a unit
 * somebody is standing next to. They are what an empty box used to become, and
 * the health score would then have acted on a measurement nobody made.
 *
 * If an engineer genuinely reads zero, the honest record is a failed test with
 * that stated in the remarks, not a number that cannot occur.
 */
const measurement = (max: number) =>
  blankToNull(
    z.coerce
      .number()
      .positive("A reading of zero is not a measurement — leave it blank if the test was not done.")
      .max(max)
      .nullable()
      .optional(),
  );

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
  // Deviation and temperatures CAN legitimately be zero or negative, so they
  // only get the blank guard, not a positive floor.
  turnsRatioDeviationPct: blankToNull(z.coerce.number().min(-100).max(100).nullable().optional()),
  windingResistanceHvOhm: measurement(10_000),
  windingResistanceLvOhm: measurement(10_000),
  oilBdvKv: measurement(200),
  oilTempC: blankToNull(z.coerce.number().min(-20).max(200).nullable().optional()),
  ambientTempC: blankToNull(z.coerce.number().min(-20).max(70).nullable().optional()),
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

export const dispatchSchema = z.object({
  destination: z.string().trim().min(3, "Where is it going?").max(120),
  region: z.string().trim().min(2, "Choose the region.").max(60),
  county: z.string().trim().max(60).optional().or(z.literal("")),
  vehiclePlate: vehiclePlateField,
  driverName: z.string().trim().min(3, "Enter the driver's name.").max(80),
  driverPhone: kenyanPhoneField.optional().or(z.literal("")),

  /**
   * The engineer who will receive it. REQUIRED, and required here rather than
   * in the UI: a transformer on a lorry with nobody's name against it is how a
   * unit sits in a yard for a fortnight while everyone assumes somebody else is
   * collecting it.
   */
  assignedEngineerId: z.string().min(1, "Choose the field engineer who will receive it."),

  expectedArrival: z.coerce.date().optional().nullable(),
  photoUrls: z.array(z.string().url()).max(6).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type DispatchInput = z.infer<typeof dispatchSchema>;

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

/**
 * Raising a movement. One submission, one or many transformers.
 *
 * The vehicle is required by the MOVEMENT, not by this schema - a scrapping in
 * place has no lorry - so the check lives in the API where the movement catalog
 * is in scope. Everything here is what a form can validate on its own.
 */
export const transactionCreateSchema = z.object({
  transformerIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one transformer.")
    .max(50, "Move at most 50 at a time."),
  movement: z.string().min(1, "Choose the kind of movement."),

  /** Store.id - required when the destination is a store or a workshop. */
  toStoreId: z.string().optional().or(z.literal("")),
  /** Free text - used when the destination is a site, a manufacturer, or scrap. */
  toName: z.string().trim().max(160).optional().or(z.literal("")),

  /**
   * Optional HERE, required at DEPARTURE.
   *
   * A transfer raised on Monday and approved on Wednesday has no lorry assigned
   * on Monday. Demanding one at this point does not produce a vehicle — it
   * produces "TBD" and invented plates in the asset register, which is worse
   * than a blank because a blank is honest about not knowing. The rule is
   * enforced where the lorry actually exists: see transactionLegSchema and the
   * DEPART branch of the leg route.
   */
  vehiclePlate: vehiclePlateField.optional().or(z.literal("")),
  driverName: z.string().trim().max(80).optional().or(z.literal("")),
  driverPhone: kenyanPhoneField.optional().or(z.literal("")),

  /**
   * The field engineer standing at the pole. Required by the API for every
   * movement whose origin is a SITE — see requiresSiteEngineer(). Not enforced
   * here because this schema cannot see which movement was chosen until the
   * route has looked it up in the catalog.
   */
  presentEngineerId: z.string().trim().optional().or(z.literal("")),

  reason: z.string().trim().max(300).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;

/** Approving or refusing raised movements, in bulk. Mirrors approvalDecisionSchema. */
export const transactionDecisionSchema = z
  .object({
    transactionIds: z
      .array(z.string().min(1))
      .min(1, "Select at least one movement.")
      .max(200, "Decide at most 200 at a time."),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(300).optional().or(z.literal("")),
    // Spent again at the moment of signature — see requirePinConfirmation().
    pin: pinField,
  })
  .refine((v) => v.decision !== "REJECT" || (v.reason && v.reason.trim().length >= 3), {
    message: "Say why it is being refused. A rejection with no reason cannot be acted on.",
    path: ["reason"],
  });

export type TransactionDecisionInput = z.infer<typeof transactionDecisionSchema>;

/**
 * Departure and arrival. Deliberately NOT approvals - these are the two people
 * who physically watched the lorry, and making them wait for a manager would
 * mean the timestamps get written from memory hours later, which is worse than
 * not recording them.
 */
export const transactionLegSchema = z.object({
  leg: z.enum(["DEPART", "ARRIVE"]),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracyM: z.coerce.number().int().min(0).max(10000).optional(),
  photoUrls: z.array(z.string().min(1)).max(5).optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),

  /**
   * Who is actually driving, supplied at the moment of departure.
   *
   * These can be given when the movement is raised, but they are only REQUIRED
   * here, on the DEPART leg — because this is the first moment a real vehicle
   * and a real driver exist. Anything supplied now overwrites what was planned,
   * so what ends up in the register is the lorry that went, not the lorry
   * somebody expected days earlier.
   */
  vehiclePlate: vehiclePlateField.optional().or(z.literal("")),
  driverName: z.string().trim().max(80).optional().or(z.literal("")),
  driverPhone: kenyanPhoneField.optional().or(z.literal("")),
});

export type TransactionLegInput = z.infer<typeof transactionLegSchema>;

/**
 * Receiving a delivery as a batch, and naming the sample that will be tested.
 *
 * The delivery note's claimed count is captured SEPARATELY from the rows
 * actually entered, because those two disagreeing is the single most useful
 * signal a goods-in process produces. Reconciling them silently would throw it
 * away.
 */
export const receiveBatchSchema = z.object({
  manufacturerId: z.string().min(1, "Choose the manufacturer."),
  /** What the delivery note says arrived. */
  totalCount: z.coerce.number().int().min(1, "How many arrived?").max(500),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  units: z
    .array(
      z.object({
        serialNumber: z.string().trim().toUpperCase().max(40).optional().or(z.literal("")),
        ratingKva: z.coerce
          .number()
          .int()
          .refine((v) => [25, 50, 100, 200, 315, 500, 1000].includes(v), "Choose a standard rating."),
        yearOfManufacture: z.coerce.number().int().min(1960).max(new Date().getFullYear()),
        /** Was this one of the few actually tested? */
        sampleTested: z.boolean().default(false),
      }),
    )
    .min(1, "Enter at least one transformer.")
    .max(500),
});

export type ReceiveBatchInput = z.infer<typeof receiveBatchSchema>;

/**
 * A checker accepting or refusing consignments — one, or many at once.
 *
 * `batchId` (singular) is still accepted so nothing that already posts the old
 * shape breaks. Both forms are normalised to `batchIds` by the route, which is
 * the only place that has to know two spellings exist.
 */
export const batchDecisionSchema = z
  .object({
    batchId: z.string().min(1).optional(),
    batchIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(300).optional().or(z.literal("")),
  })
  .refine((v) => Boolean(v.batchId) || Boolean(v.batchIds?.length), {
    message: "Select at least one consignment.",
    path: ["batchIds"],
  })
  .refine((v) => v.decision !== "REJECT" || (v.reason && v.reason.trim().length >= 3), {
    message: "Say why the consignment is being refused.",
    path: ["reason"],
  });

export type BatchDecisionInput = z.infer<typeof batchDecisionSchema>;

/**
 * Raising a request for approval.
 *
 * `action` is validated against the catalog in approvals.ts rather than being
 * repeated as a literal tuple here. The catalog is a `const` array, so a new
 * action added there is accepted here with no second edit — which is exactly
 * the failure that put STORE_MANAGER in a dropdown the API then refused.
 */
export const approvalRequestSchema = z.object({
  transformerIds: z
    .array(z.string().min(1))
    .min(1, "Choose at least one transformer.")
    .max(200, "Request at most 200 at a time."),
  action: z.string().min(1, "Choose what is being requested."),
  justification: z.string().trim().max(600).optional().or(z.literal("")),
  contextLabel: z.string().trim().max(200).optional().or(z.literal("")),
  /** Set only by the emergency install path, and never trusted from the client alone. */
  emergency: z.boolean().optional(),
});

export type ApprovalRequestInput = z.infer<typeof approvalRequestSchema>;

/** A manager signing off, or refusing, one or many requests at once. */
export const approvalDecideSchema = z
  .object({
    approvalIds: z
      .array(z.string().min(1))
      .min(1, "Select at least one request.")
      .max(200, "Decide at most 200 at a time."),
    decision: z.enum(["APPROVE", "REJECT"]),
    notes: z.string().trim().max(600).optional().or(z.literal("")),
    // Spent again at the moment of signature — see requirePinConfirmation().
    pin: pinField,
  })
  .refine((v) => v.decision !== "REJECT" || (v.notes && v.notes.trim().length >= 3), {
    message: "Say why it is being refused. A rejection with no reason cannot be acted on.",
    path: ["notes"],
  });

export type ApprovalDecideInput = z.infer<typeof approvalDecideSchema>;

/**
 * A field engineer confirming they are standing at the pole.
 *
 * GPS is optional, deliberately. Requiring a fix would make the confirmation
 * impossible in the places it matters most — a valley with no signal, a phone
 * with location switched off — and an engineer who cannot confirm will simply
 * telephone the store and have somebody else press the button, which is the
 * exact fiction this control exists to prevent. When a fix IS available it is
 * recorded, so the honest cases carry more evidence than the rest.
 */
export const presenceConfirmSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracyM: z.coerce.number().int().min(0).max(10_000).optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export type PresenceConfirmInput = z.infer<typeof presenceConfirmSchema>;
