import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getMcpSettings, mcpVisibleTo, roleAllowed } from "@/lib/mcp/settings";

/**
 * GET /api/mcp/test — the "Test Connection" button.
 *
 * Checks the three things that would actually stop a real MCP call from
 * working: the database is reachable, MCP is switched on, and this user's
 * role is allowed through. It does not perform a real OAuth round trip —
 * that requires a browser and a client redirect URI, neither of which exist
 * on a settings page — so the result is reported as what it is: whether the
 * server is ready to accept a connection, not proof a specific client has
 * one working right now.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    if (!mcpVisibleTo(user.role)) return NextResponse.json({ error: "Not available for your role." }, { status: 403 });

    const settings = await getMcpSettings();
    const allowed = roleAllowed(settings, user.role);

    let databaseReachable = true;
    try {
      await prisma.transformer.count();
    } catch {
      databaseReachable = false;
    }

    const connected = settings.enabled && allowed && databaseReachable;
    return NextResponse.json({
      connected,
      databaseReachable,
      mcpEnabled: settings.enabled,
      roleAllowed: allowed,
      message: connected
        ? "Server is reachable and ready to accept an MCP connection for your role."
        : !databaseReachable
          ? "Database is not reachable right now."
          : !settings.enabled
            ? "MCP is switched off globally."
            : "MCP is disabled for your role.",
    });
  } catch (error) {
    return apiError(error);
  }
}
