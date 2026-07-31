import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

/** DELETE — revoke a token. Its owner can always revoke it; an admin can revoke anyone's. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;

    const token = await prisma.mcpToken.findUnique({ where: { id } });
    if (!token) return NextResponse.json({ error: "Token not found." }, { status: 404 });
    if (token.userId !== user.id && user.role !== "ADMIN") {
      return NextResponse.json({ error: "You can only revoke your own tokens." }, { status: 403 });
    }

    await prisma.mcpToken.update({ where: { id }, data: { revoked: true } });

    if (user.role === "ADMIN" && token.userId !== user.id) {
      await writeAudit({
        actorId: user.id,
        action: "DISABLE",
        targetType: "McpToken",
        targetId: id,
        targetLabel: token.label ?? "MCP token",
        details: `Revoked another user's MCP token.`,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
