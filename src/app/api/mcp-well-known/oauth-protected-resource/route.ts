import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/mcp/cors";
import { logMcpAccess } from "@/lib/mcp/tokens";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * This is what the WWW-Authenticate header on a bare 401 from /api/mcp points
 * at — it tells a client which authorization server protects that resource,
 * which is the piece that makes Claude Desktop start an OAuth flow instead of
 * giving up after the 401.
 */
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  await logMcpAccess({
    userId: null, tokenId: null, tool: "oauth_discovery_protected_resource",
    argsSummary: JSON.stringify({ userAgent: request.headers.get("user-agent") }).slice(0, 300),
    success: true, authMethod: "NONE",
  });
  return withCors(NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  }));
}
