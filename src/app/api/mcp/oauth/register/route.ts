import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/mcp/oauth/register — Dynamic Client Registration (RFC 7591).
 *
 * Claude Desktop calls this once, the first time it connects to a new MCP
 * server URL, to obtain a client_id before starting the authorization flow.
 * No client_secret is issued: Claude Desktop is a public client and proves
 * itself with PKCE at the token endpoint instead, the same way any native app
 * or SPA does under OAuth 2.1 — a secret baked into a downloadable app isn't
 * one.
 */

const RegisterInput = z.object({
  redirect_uris: z.array(z.string().url()).min(1, "At least one redirect_uri is required."),
  client_name: z.string().max(200).optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata", error_description: "Body must be JSON." }, { status: 400 });
  }

  const parsed = RegisterInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const client = await prisma.mcpOAuthClient.create({
    data: {
      clientName: parsed.data.client_name ?? "MCP client",
      redirectUris: parsed.data.redirect_uris,
    },
  });

  return NextResponse.json(
    {
      client_id: client.id,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
