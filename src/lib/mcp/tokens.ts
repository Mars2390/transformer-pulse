import "server-only";
import { prisma } from "@/lib/prisma";
import { signJwt, verifyJwt } from "@/lib/jwt";
import type { Role } from "@/generated/prisma/enums";

/**
 * Every MCP credential — the short-lived authorization code and the
 * long-lived access token — is a signed JWT built on the same primitive the
 * app already uses for its own session cookie (src/lib/jwt.ts). Nothing new
 * to audit: it's the identical HS256-over-WebCrypto scheme, just with a
 * different payload shape and a database row for revocation.
 *
 * The authorization code carries everything the token exchange needs
 * (client, redirect_uri, PKCE challenge) and needs no table of its own — it
 * lives for two minutes and is self-verifying. The access token DOES have a
 * row (McpToken): the JWT signature proves the token wasn't forged, but only
 * a database check can prove it hasn't been revoked since.
 */

const AUTH_CODE_TTL_SECONDS = 120;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — no refresh grant; re-authorize via the browser after this

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters — MCP auth cannot run without it.");
  }
  return s;
}

// --- Authorization code ------------------------------------------------------

export type AuthCodePayload = {
  typ: "mcp_auth_code";
  sub: string; // userId
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
};

export async function issueAuthCode(payload: Omit<AuthCodePayload, "typ">): Promise<string> {
  return signJwt({ ...payload, typ: "mcp_auth_code" }, secret(), AUTH_CODE_TTL_SECONDS);
}

export async function verifyAuthCode(code: string): Promise<AuthCodePayload | null> {
  const payload = await verifyJwt(code, secret());
  if (!payload || payload.typ !== "mcp_auth_code") return null;
  const p = payload as unknown as AuthCodePayload;
  if (!p.sub || !p.client_id || !p.redirect_uri || !p.code_challenge) return null;
  return p;
}

/** SHA-256(code_verifier), base64url — PKCE S256, verified against the code's stored challenge. */
export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Access token -------------------------------------------------------------

export type IssuedToken = { token: string; expiresIn: number; tokenId: string };

export async function issueAccessToken(opts: {
  userId: string;
  clientId?: string | null;
  kind: "OAUTH" | "MANUAL";
  label?: string;
}): Promise<IssuedToken> {
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
  const row = await prisma.mcpToken.create({
    data: {
      userId: opts.userId,
      clientId: opts.clientId ?? null,
      kind: opts.kind,
      label: opts.label ?? null,
      expiresAt,
    },
  });
  const token = await signJwt(
    { typ: "mcp_access_token", sub: opts.userId, jti: row.id, client_id: opts.clientId ?? undefined },
    secret(),
    ACCESS_TOKEN_TTL_SECONDS,
  );
  return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS, tokenId: row.id };
}

export type VerifiedToken = {
  ok: true;
  tokenId: string;
  user: { id: string; name: string; email: string; role: Role; region: string | null };
};
export type UnverifiedToken = { ok: false; reason: "invalid_token" | "revoked" | "expired" | "user_missing" };

export async function verifyAccessToken(token: string): Promise<VerifiedToken | UnverifiedToken> {
  const payload = await verifyJwt(token, secret());
  if (!payload || payload.typ !== "mcp_access_token" || typeof payload.jti !== "string") {
    return { ok: false, reason: "invalid_token" };
  }

  const row = await prisma.mcpToken.findUnique({
    where: { id: payload.jti },
    include: { user: { select: { id: true, name: true, email: true, role: true, region: true, active: true } } },
  });
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.revoked) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (!row.user.active) return { ok: false, reason: "user_missing" };

  await prisma.mcpToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { ok: true, tokenId: row.id, user: row.user };
}

// --- Rate limiting + access log ----------------------------------------------

export async function withinRateLimit(tokenId: string, limitPerHour: number): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.mcpAccessLog.count({ where: { tokenId, occurredAt: { gte: since } } });
  return count < limitPerHour;
}

export async function logMcpAccess(opts: {
  userId: string | null;
  tokenId: string | null;
  tool: string;
  argsSummary?: string | null;
  success: boolean;
  errorMessage?: string | null;
  authMethod: "OAUTH" | "API_KEY" | "NONE";
}): Promise<void> {
  await prisma.mcpAccessLog.create({
    data: {
      userId: opts.userId,
      tokenId: opts.tokenId,
      tool: opts.tool,
      argsSummary: opts.argsSummary ?? null,
      success: opts.success,
      errorMessage: opts.errorMessage ?? null,
      authMethod: opts.authMethod,
    },
  });
}
