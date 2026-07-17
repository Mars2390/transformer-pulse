import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/generated/prisma/enums";

/**
 * Sessions.
 *
 * A signed JWT in an httpOnly cookie. Deliberately small and boring — you must
 * be able to explain this file to a KPLC security reviewer without opening a
 * browser tab.
 *
 * Everything here runs in the Edge runtime too, so middleware.ts can verify a
 * session without touching the database. That is the whole point: checking a
 * signature is microseconds; a database round trip on every request is not.
 */

export const SESSION_COOKIE = "tp_session";
const SESSION_SECONDS = 60 * 60 * 12; // 12 hours — one working shift

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  region: string | null;
  storeId: string | null;
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    name: user.name,
    email: user.email,
    role: user.role,
    region: user.region,
    storeId: user.storeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the session, or null if absent, expired, or tampered with. */
export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      role: payload.role as Role,
      region: (payload.region as string | null) ?? null,
      storeId: (payload.storeId as string | null) ?? null,
    };
  } catch {
    // Any failure — bad signature, expired, malformed — is just "not signed in".
    return null;
  }
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true, // JavaScript cannot read it, so XSS cannot steal it
  secure: process.env.NODE_ENV === "production", // HTTPS only in production
  sameSite: "lax" as const, // blocks CSRF from other origins
  path: "/",
  maxAge: SESSION_SECONDS,
};

/** Where each role lands after signing in. */
export function roleHome(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin/dashboard";
    case "MANAGER":
      return "/manager/dashboard";
    case "STORE_KEEPER":
      return "/store/dashboard";
    case "FIELD_ENGINEER":
      return "/field/dashboard";
    default:
      return "/login";
  }
}

/** Which URL prefixes each role may enter. */
export const ROLE_AREAS: Record<Role, string[]> = {
  ADMIN: ["/admin", "/transformers", "/manager", "/store", "/field"],
  MANAGER: ["/manager", "/transformers"],
  STORE_KEEPER: ["/store", "/transformers"],
  FIELD_ENGINEER: ["/field", "/transformers"],
};

export function canEnter(role: Role, pathname: string): boolean {
  return ROLE_AREAS[role]?.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
