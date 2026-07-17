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

/** Turns a Zod error into { field: "message" } for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
