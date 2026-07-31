import { NextResponse } from "next/server";

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414).
 *
 * Reachable at /.well-known/oauth-authorization-server via the rewrite in
 * next.config.ts — Next.js route files can't literally live under a
 * dot-prefixed folder, so the real handler sits here and the well-known path
 * is rewritten to it.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
