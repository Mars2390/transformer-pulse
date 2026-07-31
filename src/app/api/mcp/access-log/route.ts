import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { mcpVisibleTo } from "@/lib/mcp/settings";

/**
 * GET /api/mcp/access-log — recent MCP tool calls.
 *
 * An admin sees everyone's — this is the audit trail the settings page
 * promises. Anyone else sees only their own calls. Real names are fine here:
 * this is an internal admin view, not a response Claude ever sees, which is
 * the whole distinction the tool layer's masking exists to enforce elsewhere.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    if (!mcpVisibleTo(user.role)) return NextResponse.json({ error: "Not available for your role." }, { status: 403 });

    const entries = await prisma.mcpAccessLog.findMany({
      where: user.role === "ADMIN" ? {} : { userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: 100,
      include: { user: { select: { name: true, role: true } } },
    });

    return NextResponse.json({
      entries: entries.map((e) => ({
        id: e.id,
        user: e.user ? `${e.user.name} (${e.user.role})` : "Unknown",
        tool: e.tool,
        success: e.success,
        errorMessage: e.errorMessage,
        authMethod: e.authMethod,
        occurredAt: e.occurredAt.toISOString(),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
