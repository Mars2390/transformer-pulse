import { NextResponse } from "next/server";
import { MCP_TOOLS, findTool } from "@/lib/mcp/tools";
import { verifyAccessToken, withinRateLimit, logMcpAccess } from "@/lib/mcp/tokens";
import { getMcpSettings, roleAllowed } from "@/lib/mcp/settings";
import { corsPreflight, withCors } from "@/lib/mcp/cors";
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
const SERVER_VERSION = "1.0.0";

function wwwAuthenticateHeader(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
}

function unauthorized(origin: string, message: string) {
  return withCors(NextResponse.json(
    { jsonrpc: "2.0", error: { code: -32001, message } },
    { status: 401, headers: { "WWW-Authenticate": wwwAuthenticateHeader(origin) } },
  ));
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
  return withCors(NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result }));
}
function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return withCors(NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }));
}

function statusHtml(info: {
  statusLabel: string;
  message: string;
  version: string;
  protocolVersion: string;
  toolCount: number;
  settingsUrl: string;
  docsUrl: string;
}): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transformer Pulse — MCP Server</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;padding:0;color:#1c1f1f}
  .card{max-width:480px;margin:64px auto;background:#fff;border:1px solid #e3e6ec;border-radius:16px;padding:32px}
  h1{font-size:18px;color:#0a1a4f;margin:0 0 4px}
  p{font-size:13px;color:#5b6480;line-height:1.6}
  .status{display:inline-block;font-weight:700;font-size:13px;background:#f7f8fa;border-radius:10px;padding:8px 14px;margin:12px 0}
  dl{font-size:13px;margin:16px 0;background:#f7f8fa;border-radius:10px;padding:12px 16px}
  dt{color:#5b6480;float:left;clear:left;width:110px}
  dd{margin:0 0 4px 110px;color:#1c1f1f;font-weight:600}
  .links{margin-top:20px;display:flex;gap:10px}
  a.btn{flex:1;text-align:center;text-decoration:none;border-radius:10px;padding:12px;font-size:13px;font-weight:700}
  a.primary{background:#006837;color:#fff}
  a.secondary{background:#fff;color:#0a1a4f;border:1px solid #e3e6ec}
</style></head><body><div class="card">
  <h1>Transformer Pulse MCP Server</h1>
  <p>${info.message}</p>
  <div class="status">${info.statusLabel}</div>
  <dl>
    <dt>Version</dt><dd>${info.version}</dd>
    <dt>Protocol</dt><dd>${info.protocolVersion}</dd>
    <dt>Tools</dt><dd>${info.toolCount} available</dd>
  </dl>
  <div class="links">
    <a class="btn primary" href="${info.settingsUrl}">MCP settings</a>
    <a class="btn secondary" href="${info.docsUrl}">Documentation</a>
  </div>
</div></body></html>`;
}

/**
 * A real MCP client's GET is a protocol request, not a page visit: the
 * Streamable HTTP transport lets a client open this method to receive
 * server-initiated messages over SSE, identified by headers no browser tab
 * or health check would ever send — an auth credential, an active session,
 * or an Accept that asks for an event stream. We don't implement that
 * optional SSE half, and the spec is explicit that responding 405 to it is
 * correct and something conformant clients already handle gracefully. Only
 * requests WITHOUT any of these signals are a human or a monitor, and get
 * the friendly status page instead of a bare 405.
 */
function looksLikeMcpClient(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return (
    accept.includes("text/event-stream") ||
    request.headers.has("authorization") ||
    request.headers.has("x-api-key") ||
    request.headers.has("mcp-session-id") ||
    request.headers.has("mcp-protocol-version")
  );
}

export async function OPTIONS() {
  return corsPreflight();
}

/**
 * GET /api/mcp — a status page for humans and health checks; a spec-correct
 * 405 for an MCP client probing the optional SSE stream.
 *
 * MCP itself is JSON-RPC over POST. A GET here either comes from a person
 * opening the URL in a browser (e.g. testing the link from the settings
 * page), a health check hitting it blind, or a real MCP client checking
 * whether this endpoint also offers a server-push SSE stream. The first two
 * should never see a bare "Method Not Allowed" — this answers 200,
 * unauthenticated, with enough info to confirm the server is alive: a
 * browser (Accept: text/html) gets the styled page, anything else gets the
 * same information as JSON. The third gets the actual protocol-correct
 * answer: we don't offer SSE, so 405 with an Allow header is the right
 * response, not a made-up 200.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;

  if (looksLikeMcpClient(request)) {
    return withCors(new NextResponse(null, { status: 405, headers: { Allow: "POST" } }));
  }

  let enabled = true;
  try {
    enabled = (await getMcpSettings()).enabled;
  } catch {
    // Database unreachable — still answer the health check rather than 500.
  }

  const info = {
    status: enabled ? "online" : "disabled",
    statusLabel: enabled ? "🟢 Online" : "🔴 Disabled",
    message: "Transformer Pulse MCP Server is running. Connect via Claude Desktop or use POST requests with proper authentication.",
    server: "transformer-pulse",
    version: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    toolCount: MCP_TOOLS.length,
    endpoint: `${origin}/api/mcp`,
    settingsUrl: `${origin}/mcp`,
    docsUrl: `${origin}/api/mcp/docs`,
  };

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) {
    return withCors(new NextResponse(statusHtml(info), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
  }
  return withCors(NextResponse.json(info, { status: 200 }));
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
    return withCors(NextResponse.json({ jsonrpc: "2.0", error: { code: -32002, message: "MCP access is disabled for your role." } }, { status: 403 }));
  }

  if (!(await withinRateLimit(verified.tokenId, settings.rateLimitPerHour))) {
    await logMcpAccess({ userId: verified.user.id, tokenId: verified.tokenId, tool: "rate_limit", success: false, errorMessage: "rate_limited", authMethod: credential.authMethod });
    return withCors(NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32003, message: `Rate limit exceeded (${settings.rateLimitPerHour} requests/hour).` } },
      { status: 429 },
    ));
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
      serverInfo: { name: "transformer-pulse", version: SERVER_VERSION },
    });
  }

  if (method === "notifications/initialized" || method === "ping") {
    return withCors(new NextResponse(null, { status: 202 }));
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
