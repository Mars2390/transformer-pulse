import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getMcpSettings, roleAllowed } from "@/lib/mcp/settings";
import { issueAuthCode, logMcpAccess } from "@/lib/mcp/tokens";
import { ROLE_LABELS } from "@/lib/format";

/**
 * GET/POST /api/mcp/oauth/authorize — the browser-facing half of the flow.
 *
 * Claude Desktop opens this in the system browser. There is no new sign-in
 * screen to build: an unauthenticated visitor is bounced to the SAME /login
 * page every other part of the app uses, with `next` pointing back here, so
 * the existing email+PIN flow is the one Claude Desktop's browser goes
 * through too. Once signed in, this shows one consent screen and, on
 * approval, redirects back to the client with a short-lived authorization code.
 */

function html(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Transformer Pulse — Connect Claude</title>` +
      `<style>
        body{font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;padding:0;color:#1c1f1f}
        .card{max-width:440px;margin:64px auto;background:#fff;border:1px solid #e3e6ec;border-radius:16px;padding:32px}
        h1{font-size:18px;color:#0a1a4f;margin:0 0 4px}
        p{font-size:13px;color:#5b6480;line-height:1.5}
        .scope{background:#f7f8fa;border-radius:10px;padding:12px 16px;margin:16px 0;font-size:13px}
        .row{display:flex;gap:10px;margin-top:20px}
        button{flex:1;border-radius:10px;padding:12px;font-size:14px;font-weight:700;border:none;cursor:pointer}
        .approve{background:#006837;color:#fff}
        .deny{background:#fff;color:#0a1a4f;border:1px solid #e3e6ec}
      </style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

type AuthorizeParams = {
  response_type: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  state: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
};

function readParams(url: URL): AuthorizeParams {
  return {
    response_type: url.searchParams.get("response_type"),
    client_id: url.searchParams.get("client_id"),
    redirect_uri: url.searchParams.get("redirect_uri"),
    state: url.searchParams.get("state"),
    code_challenge: url.searchParams.get("code_challenge"),
    code_challenge_method: url.searchParams.get("code_challenge_method"),
  };
}

async function validateRequest(p: AuthorizeParams) {
  if (p.response_type !== "code") return { error: "unsupported_response_type" as const };
  if (!p.client_id || !p.redirect_uri || !p.code_challenge) return { error: "invalid_request" as const };
  if (p.code_challenge_method !== "S256") return { error: "invalid_request" as const, detail: "Only S256 PKCE is supported." };

  const client = await prisma.mcpOAuthClient.findUnique({ where: { id: p.client_id } });
  if (!client) return { error: "invalid_client" as const };
  if (!client.redirectUris.includes(p.redirect_uri)) return { error: "invalid_request" as const, detail: "redirect_uri does not match the registered client." };

  return { client };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userAgent = request.headers.get("user-agent");
  const p = readParams(url);
  const validated = await validateRequest(p);
  if ("error" in validated) {
    await logMcpAccess({
      userId: null, tokenId: null, tool: "oauth_authorize_get",
      argsSummary: JSON.stringify({ userAgent, clientId: p.client_id, redirectUri: p.redirect_uri, hasResource: url.searchParams.has("resource") }).slice(0, 300),
      success: false, errorMessage: validated.detail ?? validated.error, authMethod: "NONE",
    });
    return html(`<h1>Can't connect</h1><p>${validated.detail ?? validated.error}</p>`, 400);
  }

  const user = await getSession();
  if (!user) {
    await logMcpAccess({
      userId: null, tokenId: null, tool: "oauth_authorize_get",
      argsSummary: JSON.stringify({ userAgent, clientId: p.client_id, redirectUri: p.redirect_uri, hasResource: url.searchParams.has("resource") }).slice(0, 300),
      success: false, errorMessage: "no_session_redirected_to_login", authMethod: "NONE",
    });
    const next = `${url.pathname}?${url.searchParams.toString()}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url.origin));
  }

  const settings = await getMcpSettings();
  if (!roleAllowed(settings, user.role)) {
    await logMcpAccess({
      userId: user.id, tokenId: null, tool: "oauth_authorize_get",
      argsSummary: JSON.stringify({ userAgent, clientId: p.client_id }).slice(0, 300),
      success: false, errorMessage: "role_not_allowed", authMethod: "NONE",
    });
    return html(
      `<h1>MCP access is off for your role</h1><p>Your role (${ROLE_LABELS[user.role]}) does not currently have MCP access enabled. Ask an admin to enable it from the MCP settings page.</p>`,
      403,
    );
  }

  await logMcpAccess({
    userId: user.id, tokenId: null, tool: "oauth_authorize_get",
    argsSummary: JSON.stringify({ userAgent, clientId: p.client_id, redirectUri: p.redirect_uri }).slice(0, 300),
    success: true, authMethod: "NONE",
  });

  return html(`
    <h1>Connect Claude to Transformer Pulse</h1>
    <p>Signed in as <strong>${user.name}</strong> (${ROLE_LABELS[user.role]}${user.region ? ` · ${user.region}` : ""}).</p>
    <div class="scope">
      <strong>${validated.client.clientName ?? "This app"}</strong> is requesting read-only access to:
      <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#1c1f1f">
        <li>Transformer health, load, and inspection data</li>
        <li>Manufacturer performance and warranty claims</li>
        <li>Fleet summaries scoped to your region</li>
      </ul>
      No data can be created, changed, or deleted through this connection.
    </div>
    <form method="POST">
      <input type="hidden" name="client_id" value="${validated.client.id}">
      <input type="hidden" name="redirect_uri" value="${p.redirect_uri}">
      <input type="hidden" name="state" value="${p.state ?? ""}">
      <input type="hidden" name="code_challenge" value="${p.code_challenge}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <div class="row">
        <button class="deny" name="decision" value="deny">Deny</button>
        <button class="approve" name="decision" value="approve">Approve</button>
      </div>
    </form>
  `);
}

export async function POST(request: Request) {
  const userAgent = request.headers.get("user-agent");
  const form = await request.formData();
  const p: AuthorizeParams = {
    response_type: "code",
    client_id: String(form.get("client_id") ?? ""),
    redirect_uri: String(form.get("redirect_uri") ?? ""),
    state: String(form.get("state") ?? ""),
    code_challenge: String(form.get("code_challenge") ?? ""),
    code_challenge_method: String(form.get("code_challenge_method") ?? "S256"),
  };
  const decision = String(form.get("decision") ?? "");
  const summary = () => JSON.stringify({ userAgent, clientId: p.client_id, decision }).slice(0, 300);

  const validated = await validateRequest(p);
  if ("error" in validated) {
    await logMcpAccess({ userId: null, tokenId: null, tool: "oauth_authorize_post", argsSummary: summary(), success: false, errorMessage: validated.detail ?? validated.error, authMethod: "NONE" });
    return html(`<h1>Can't connect</h1><p>${validated.detail ?? validated.error}</p>`, 400);
  }

  const redirectUrl = new URL(p.redirect_uri!);
  if (p.state) redirectUrl.searchParams.set("state", p.state);

  if (decision !== "approve") {
    await logMcpAccess({ userId: null, tokenId: null, tool: "oauth_authorize_post", argsSummary: summary(), success: false, errorMessage: "user_denied", authMethod: "NONE" });
    redirectUrl.searchParams.set("error", "access_denied");
    return NextResponse.redirect(redirectUrl);
  }

  const user = await getSession();
  if (!user) {
    await logMcpAccess({ userId: null, tokenId: null, tool: "oauth_authorize_post", argsSummary: summary(), success: false, errorMessage: "session_expired", authMethod: "NONE" });
    return html(`<h1>Session expired</h1><p>Please try connecting again.</p>`, 401);
  }

  const settings = await getMcpSettings();
  if (!roleAllowed(settings, user.role)) {
    await logMcpAccess({ userId: user.id, tokenId: null, tool: "oauth_authorize_post", argsSummary: summary(), success: false, errorMessage: "role_not_allowed", authMethod: "NONE" });
    return html(`<h1>MCP access is off for your role</h1><p>Ask an admin to enable it from the MCP settings page.</p>`, 403);
  }

  await logMcpAccess({ userId: user.id, tokenId: null, tool: "oauth_authorize_post", argsSummary: summary(), success: true, authMethod: "NONE" });

  const code = await issueAuthCode({
    sub: user.id,
    client_id: p.client_id!,
    redirect_uri: p.redirect_uri!,
    code_challenge: p.code_challenge!,
    code_challenge_method: "S256",
  });

  redirectUrl.searchParams.set("code", code);
  return NextResponse.redirect(redirectUrl);
}
