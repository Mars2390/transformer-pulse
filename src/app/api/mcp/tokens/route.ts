import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getMcpSettings, mcpVisibleTo, roleAllowed } from "@/lib/mcp/settings";
import { issueAccessToken } from "@/lib/mcp/tokens";

/**
 * GET — the signed-in user's own MCP tokens (never everyone's — that view is
 * the access log, admin-only, and shows activity rather than live secrets).
 * POST — generate a new manual token for yourself, e.g. to paste into a
 * simpler client that doesn't do the OAuth browser flow.
 */

export async function GET() {
  try {
    const user = await requireApiUser();
    if (!mcpVisibleTo(user.role)) return NextResponse.json({ error: "Not available for your role." }, { status: 403 });

    const tokens = await prisma.mcpToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true, revoked: true },
    });
    return NextResponse.json({ tokens });
  } catch (error) {
    return apiError(error);
  }
}

const CreateInput = z.object({ label: z.string().max(60).optional() });

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const settings = await getMcpSettings();
    if (!roleAllowed(settings, user.role)) {
      return NextResponse.json({ error: "MCP access is disabled for your role. Ask an admin to enable it." }, { status: 403 });
    }

    const { label } = CreateInput.parse(await request.json().catch(() => ({})));
    const issued = await issueAccessToken({ userId: user.id, kind: "MANUAL", label: label ?? "Manual API key" });

    // The raw token is shown exactly once — like every other API-key issuer,
    // it is not retrievable again, only revocable.
    return NextResponse.json({ token: issued.token, expiresIn: issued.expiresIn, tokenId: issued.tokenId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
