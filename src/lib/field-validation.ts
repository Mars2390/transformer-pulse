import { z } from "zod";
import { latitude, longitude } from "./coords";
import { testValuesSchema } from "./validation";

/**
 * Validation for the field engineer's actions. Kept separate from the store's
 * schemas so each role's inputs stay easy to read.
 *
 * The test object omits `stage`: the phone never sends it, because which stage
 * a reading belongs to (commissioning, routine, post-fault) is decided by WHICH
 * action was taken, not by the engineer. Each route sets it before saving.
 */
const fieldTest = testValuesSchema.omit({ stage: true });

const gps = {
  lat: latitude.optional().nullable(),
  lng: longitude.optional().nullable(),
  accuracyM: z.coerce.number().min(0).max(10000).optional().nullable(),
};

const photos = z.array(z.string().url()).max(5).optional();

export const confirmReceiptSchema = z.object({
  ...gps,
  photoUrls: photos,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export const installSchema = z.object({
  ...gps,
  photoUrls: z.array(z.string().url()).min(1, "A photo is required.").max(5),
  siteName: z.string().trim().min(3, "Enter the site name.").max(120),
  feeder: z.string().trim().max(80).optional().or(z.literal("")),
  sdb: z.string().trim().max(80).optional().or(z.literal("")),
  test: fieldTest,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),

  /**
   * Proceeding without a signed installation approval, to restore supply.
   *
   * Deliberately NOT a checkbox on its own. The reason is required and has a
   * floor of fifteen characters, because "emergency" as a justification tells a
   * manager reviewing it afterwards nothing at all, and this is the one path in
   * the system where the work happens before anybody agrees to it. It is
   * printed on the face of the certificate, so it will be read.
   */
  emergency: z.boolean().optional(),
  emergencyReason: z.string().trim().max(400).optional().or(z.literal("")),
}).refine(
  (v) => !v.emergency || (v.emergencyReason ?? "").trim().length >= 15,
  {
    message:
      "Say what the emergency is — how many customers are off, and since when. A manager has to ratify this afterwards and needs to know why.",
    path: ["emergencyReason"],
  },
);

/** The extended field inspection checklist folds into the test remarks. */
export const inspectVisualSchema = z.object({
  tankCondition: z.enum(["GOOD", "DAMAGED"]),
  bushings: z.enum(["GOOD", "DAMAGED"]),
  silicaGel: z.enum(["BLUE", "PINK", "WHITE"]),
  oilLevel: z.enum(["NORMAL", "LOW"]),
  oilLeaks: z.enum(["NONE", "MINOR", "MAJOR"]),
  earthing: z.enum(["INTACT", "DAMAGED"]),
  security: z.enum(["GOOD", "DAMAGED"]),
  vegetation: z.enum(["ADEQUATE", "OVERGROWN"]),
});

export const inspectSchema = z.object({
  ...gps,
  photoUrls: photos,
  test: fieldTest,
  visual: inspectVisualSchema,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export const FAULT_CAUSES = [
  "Lightning / flashover",
  "Overheating",
  "Winding failure",
  "Oil loss / leakage",
  "Bushing failure",
  "Vandalism",
  "Theft",
  "Other",
] as const;

export const faultSchema = z.object({
  ...gps,
  photoUrls: z.array(z.string().url()).min(1, "A photo of the damage is required.").max(5),
  cause: z.enum(FAULT_CAUSES),
  description: z.string().trim().min(5, "Describe what happened.").max(1000),
  test: fieldTest.optional().nullable(),
});

export const replaceSchema = z.object({
  newTransformerId: z.string().min(1, "Choose the replacement transformer."),
  ...gps,
  siteName: z.string().trim().min(3).max(120),
  oldPhotoUrls: z.array(z.string().url()).max(5).optional(),
  newPhotoUrls: z.array(z.string().url()).min(1, "A photo of the new unit is required.").max(5),
  test: fieldTest,
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
