import { NextResponse } from "next/server";
import { MCP_TOOLS, findTool } from "@/lib/mcp/tools";
import { verifyAccessToken, withinRateLimit, logMcpAccess } from "@/lib/mcp/tokens";
import { getMcpSettings, roleAllowed } from "@/lib/mcp/settings";
import { ZodError } from "zod";

/**
 * POST /api/mcp — the remote MCP endpoint, JSON-RPC 2.0 over HTTP.
 *
 * Implemented directly rather than through the SDK's StreamableHTTPServerTransport:
 * that transport is built around Node's raw http.IncomingMessage/ServerResponse,
 * and adapting it to a Next.js Route Handler's Fetch-API Request/Response — on
 * Vercel's serverless model, one request per invocation, no persistent session
 * needed — is more moving parts than the surface this route actually needs
 * (initialize, tools/list, tools/call). The stdio server for local Claude
 * Desktop use (mcp-server.ts) DOES use the official SDK, where a raw process
 * pipe is exactly what it's designed for.
 *
 * Auth auto-detects across three shapes so a client can use whichever it
 * supports: `Authorization: Bearer <token>` (what an OAuth-connected client
 * sends), `X-API-Key: <token>`, or `?key=<token>` (for a manually generated
 * key pasted into a simpler client). All three are the same underlying signed
 * token — only the transport differs — but which one carried it is recorded
 * in the access log as OAUTH vs API_KEY.
 */

const PROTOCOL_VERSION = "2024-11-05";

function wwwAuthenticateHeader(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

function unauthorized(origin: string, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32001, message } },
    { status: 401, headers: { "WWW-Authenticate": wwwAuthenticateHeader(origin) } },
  );
}

function extractCredential(request: Request, url: URL): { token: string; authMethod: "OAUTH" | "API_KEY" } | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return { token: auth.slice(7).trim(), authMethod: "OAUTH" };

  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return { token: apiKeyHeader.trim(), authMethod: "API_KEY" };

  const apiKeyQuery = url.searchParams.get("key");
  if (apiKeyQuery) return { token: apiKeyQuery.trim(), authMethod: "API_KEY" };

  return null;
}

type JsonRpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  // --- Auth ------------------------------------------------------------------
  const credential = extractCredential(request, url);
  if (!credential) return unauthorized(origin, "Sign-in required. Connect via OAuth or provide an API key.");

  const verified = await verifyAccessToken(credential.token);
  if (!verified.ok) {
    await logMcpAccess({ userId: null, tokenId: null, tool: "auth", success: false, errorMessage: verified.reason, authMethod: credential.authMethod });
    return unauthorized(origin, `Token ${verified.reason.replace("_", " ")}. Reconnect to get a new one.`);
  }

  const settings = await getMcpSettings();
  if (!roleAllowed(settings, verified.user.role)) {
    await logMcpAccess({ userId: verified.user.id, tokenId: verified.tokenId, tool: "auth", success: false, errorMessage: "role_not_allowed", authMethod: credential.authMethod });
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32002, message: "MCP access is disabled for your role." } }, { status: 403 });
  }

  if (!(await withinRateLimit(verified.tokenId, settings.rateLimitPerHour))) {
    await logMcpAccess({ userId: verified.user.id, tokenId: verified.tokenId, tool: "rate_limit", success: false, errorMessage: "rate_limited", authMethod: credential.authMethod });
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32003, message: `Rate limit exceeded (${settings.rateLimitPerHour} requests/hour).` } },
      { status: 429 },
    );
  }

  // --- JSON-RPC ----------------------------------------------------------------
  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body must be JSON.");
  }

  const { id, method, params } = body;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "transformer-pulse", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized" || method === "ping") {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema })),
    });
  }

  if (method === "tools/call") {
    const p = params as { name?: string; arguments?: unknown } | undefined;
    const tool = p?.name ? findTool(p.name) : undefined;
    if (!tool) return rpcError(id, -32602, `Unknown tool "${p?.name}".`);

    try {
      const result = await tool.handler(p?.arguments ?? {});
      await logMcpAccess({
        userId: verified.user.id, tokenId: verified.tokenId, tool: tool.name,
        argsSummary: JSON.stringify(p?.arguments ?? {}).slice(0, 300),
        success: true, authMethod: credential.authMethod,
      });
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (error) {
      const message = error instanceof ZodError ? error.issues.map((i) => i.message).join("; ") : error instanceof Error ? error.message : "Unknown error";
      await logMcpAccess({
        userId: verified.user.id, tokenId: verified.tokenId, tool: tool.name,
        argsSummary: JSON.stringify(p?.arguments ?? {}).slice(0, 300),
        success: false, errorMessage: message, authMethod: credential.authMethod,
      });
      return rpcResult(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
    }
  }

  return rpcError(id, -32601, `Method "${method}" not found.`);
}
