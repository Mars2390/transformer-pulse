import { z } from "zod";
import { emailField, pinField } from "./validation";

/** Validation for admin management of users, manufacturers and stores. */

export const ROLES = ["ADMIN", "MANAGER", "STORE_KEEPER", "FIELD_ENGINEER"] as const;

export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(3, "Enter the full name.").max(80),
  email: emailField,
  pin: pinField,
  role: z.enum(ROLES),
  region: z.string().trim().max(60).optional().or(z.literal("")),
  storeId: z.string().trim().optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^(\+254|0)[17]\d{8}$/, "Enter a valid Kenyan number, e.g. 0722123456.")
    .optional()
    .or(z.literal("")),
});

/** Editing cannot change the email (it is the stable identifier) or the PIN. */
export const adminEditUserSchema = z.object({
  name: z.string().trim().min(3).max(80),
  role: z.enum(ROLES),
  region: z.string().trim().max(60).optional().or(z.literal("")),
  storeId: z.string().trim().optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^(\+254|0)[17]\d{8}$/, "Enter a valid Kenyan number, e.g. 0722123456.")
    .optional()
    .or(z.literal("")),
});

export const userActionSchema = z.object({
  action: z.enum(["disable", "enable", "unlock", "resetPin"]),
});

export const manufacturerSchema = z.object({
  name: z.string().trim().min(2, "Enter the name.").max(80),
  country: z.string().trim().max(60).optional().or(z.literal("")),
  warrantyMonths: z.coerce.number().int().min(0).max(120),
  contactName: z.string().trim().max(80).optional().or(z.literal("")),
  contactEmail: z.string().trim().max(120).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
});

export const storeSchema = z.object({
  name: z.string().trim().min(3, "Enter the store name.").max(80),
  code: z.string().trim().min(2, "Enter a store code.").max(20).toUpperCase(),
  region: z.string().trim().min(2, "Enter the region.").max(60),
  county: z.string().trim().min(2, "Enter the county.").max(60),
  lat: z.coerce.number().min(-5).max(6).optional().nullable(),
  lng: z.coerce.number().min(33).max(42).optional().nullable(),
});

/** A cryptographically-random 6-digit PIN for admin resets. */
export function generatePin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}
