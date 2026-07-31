import type { Role } from "@/generated/prisma/enums";
import { signJwt, verifyJwt } from "./jwt";

/**
 * Sessions.
 *
 * A signed JWT in an httpOnly cookie, verified with WebCrypto — no library.
 * Everything here runs in the Edge runtime, so middleware.ts can check a
 * session without touching the database. That is the point: verifying a
 * signature takes microseconds; a database round trip on every request does not.
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

/**
 * Returns the signing secret, or null if it is unusable.
 *
 * Deliberately does NOT throw. This is read on every request in Edge
 * middleware, and a throw there takes down the entire site — including the
 * public landing page, which needs no session at all. A missing secret must
 * mean "nobody is signed in", not "nothing works".
 */
function getSecret(): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return null;
  return secret;
}

/** True when the server is configured well enough for anyone to sign in. */
export function isAuthConfigured(): boolean {
  return getSecret() !== null;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    // Only reachable from the login route, in the Node runtime, where throwing
    // gives an operator a real message instead of a silent failed login.
    throw new Error(
      "AUTH_SECRET is missing or shorter than 32 characters. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n" +
        "then add it in Vercel → Settings → Environment Variables and redeploy.",
    );
  }

  return signJwt(
    {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      region: user.region,
      storeId: user.storeId,
    },
    secret,
    SESSION_SECONDS,
  );
}

/** Returns the session, or null if absent, expired, forged — or misconfigured. */
export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  const payload = await verifyJwt(token, getSecret() ?? undefined);
  if (!payload?.sub) return null;

  return {
    id: String(payload.sub),
    name: String(payload.name ?? ""),
    email: String(payload.email ?? ""),
    role: payload.role as Role,
    region: (payload.region as string | null) ?? null,
    storeId: (payload.storeId as string | null) ?? null,
  };
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
  ADMIN: ["/admin", "/transformers", "/manager", "/store", "/field", "/kplc-control", "/mcp"],
  MANAGER: ["/manager", "/transformers", "/kplc-control", "/mcp"],
  STORE_KEEPER: ["/store", "/transformers", "/mcp"],
  FIELD_ENGINEER: ["/field", "/transformers"],
};

export function canEnter(role: Role, pathname: string): boolean {
  return ROLE_AREAS[role]?.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
