import { NextResponse } from "next/server";
import { verifyAuthCode, pkceChallengeFromVerifier, issueAccessToken, logMcpAccess } from "@/lib/mcp/tokens";
import { corsPreflight, withCors } from "@/lib/mcp/cors";

/**
 * POST /api/mcp/oauth/token — exchanges an authorization code for an access token.
 *
 * Only the `authorization_code` grant is implemented — no refresh tokens. The
 * access token is long-lived (30 days) instead: simpler than rotating
 * refresh tokens, and the admin settings page can revoke it instantly if
 * that 30 days ever needs to end sooner. When it does expire, Claude Desktop
 * just re-runs the same browser flow.
 */

async function readBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    return json && typeof json === "object" ? (json as Record<string, string>) : {};
  }
  const form = await request.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) out[k] = String(v);
  return out;
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  const userAgent = request.headers.get("user-agent");
  const body = await readBody(request);
  const summary = () => JSON.stringify({ userAgent, grantType: body.grant_type, clientId: body.client_id, hasResource: "resource" in body }).slice(0, 300);

  if (body.grant_type !== "authorization_code") {
    await logMcpAccess({ userId: null, tokenId: null, tool: "oauth_token", argsSummary: summary(), success: false, errorMessage: "unsupported_grant_type", authMethod: "NONE" });
    return withCors(NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 }));
  }
  if (!body.code || !body.redirect_uri || !body.client_id || !body.code_verifier) {
    await logMcpAccess({ userId: null, tokenId: null, tool: "oauth_token", argsSummary: summary(), success: false, errorMessage: "invalid_request: missing field", authMethod: "NONE" });
    return withCors(NextResponse.json({ error: "invalid_request" }, { status: 400 }));
  }

  const payload = await verifyAuthCode(body.code);
  if (!payload) {
    await logMcpAccess({ userId: null, tokenId: null, tool: "oauth_token", argsSummary: summary(), success: false, errorMessage: "invalid_grant: code invalid or expired", authMethod: "NONE" });
    return withCors(NextResponse.json({ error: "invalid_grant", error_description: "Code is invalid or expired." }, { status: 400 }));
  }
  if (payload.client_id !== body.client_id || payload.redirect_uri !== body.redirect_uri) {
    await logMcpAccess({ userId: payload.sub, tokenId: null, tool: "oauth_token", argsSummary: summary(), success: false, errorMessage: "invalid_grant: client_id/redirect_uri mismatch", authMethod: "NONE" });
    return withCors(NextResponse.json({ error: "invalid_grant", error_description: "client_id or redirect_uri does not match the authorization request." }, { status: 400 }));
  }

  const computedChallenge = await pkceChallengeFromVerifier(body.code_verifier);
  if (computedChallenge !== payload.code_challenge) {
    await logMcpAccess({ userId: payload.sub, tokenId: null, tool: "oauth_token", argsSummary: summary(), success: false, errorMessage: "invalid_grant: PKCE verification failed", authMethod: "NONE" });
    return withCors(NextResponse.json({ error: "invalid_grant", error_description: "PKCE verification failed." }, { status: 400 }));
  }

  const issued = await issueAccessToken({ userId: payload.sub, clientId: payload.client_id, kind: "OAUTH" });

  await logMcpAccess({ userId: payload.sub, tokenId: issued.tokenId, tool: "oauth_token", argsSummary: summary(), success: true, authMethod: "OAUTH" });

  return withCors(NextResponse.json({
    access_token: issued.token,
    token_type: "Bearer",
    expires_in: issued.expiresIn,
    scope: "read",
  }));
}
