import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { getMcpSettings } from "@/lib/mcp/settings";
import { prisma } from "@/lib/prisma";
import { McpSettingsClient } from "@/components/mcp/McpSettingsClient";

export const metadata: Metadata = { title: "MCP settings" };
export const dynamic = "force-dynamic";

/**
 * The MCP settings page — visible to Admin, Manager, and Store Keeper.
 *
 * Everyone who can see it gets the same page; what differs is what the
 * client component lets them DO. An admin can flip the global switch and
 * lock any role out; everyone else sees those settings read-only and manages
 * only their own token and their own slice of the access log.
 */
export default async function McpPage() {
  const user = await requireRole("ADMIN", "MANAGER", "STORE_KEEPER");
  const settings = await getMcpSettings();

  const [myTokens, accessLog] = await Promise.all([
    prisma.mcpToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true, revoked: true },
    }),
    prisma.mcpAccessLog.findMany({
      where: user.role === "ADMIN" ? {} : { userId: user.id },
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: { user: { select: { name: true, role: true } } },
    }),
  ]);

  return (
    <McpSettingsClient
      role={user.role}
      settings={{
        enabled: settings.enabled,
        rateLimitPerHour: settings.rateLimitPerHour,
        managerEnabled: settings.managerEnabled,
        storeKeeperEnabled: settings.storeKeeperEnabled,
        fieldEngineerEnabled: settings.fieldEngineerEnabled,
      }}
      myTokens={myTokens.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.label,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        expiresAt: t.expiresAt.toISOString(),
        revoked: t.revoked,
      }))}
      accessLog={accessLog.map((e) => ({
        id: e.id,
        user: e.user ? `${e.user.name} (${e.user.role})` : "Unknown",
        tool: e.tool,
        success: e.success,
        errorMessage: e.errorMessage,
        authMethod: e.authMethod,
        occurredAt: e.occurredAt.toISOString(),
      }))}
    />
  );
}
