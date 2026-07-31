import "server-only";

/**
 * CORS for the MCP HTTP surface.
 *
 * Claude's remote-connector setup (dynamic client registration, token
 * exchange, and the JSON-RPC endpoint itself) is called via `fetch()` from a
 * browser-context client. Any cross-origin fetch that carries an
 * `Authorization` or custom header (we use `X-Api-Key`, and MCP's own spec
 * defines `Mcp-Session-Id` / `MCP-Protocol-Version`) triggers a CORS
 * preflight `OPTIONS` request first. None of these routes exported an
 * `OPTIONS` handler, so Next.js answered every preflight with a bare 405
 * "Method Not Allowed" — which is exactly the error the client surfaced, on
 * a request that never even reached our auth or JSON-RPC logic.
 */
export const MCP_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(MCP_CORS_HEADERS)) response.headers.set(key, value);
  return response;
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
}
