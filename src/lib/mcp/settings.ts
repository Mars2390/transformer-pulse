import "@/lib/server-guard";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";
import type { McpSettings } from "@/generated/prisma/client";

/**
 * MCP is off by default in spirit, on by default in the row: the settings
 * singleton is created lazily on first read so a fresh deployment doesn't
 * need a seed step, but every gate below defaults to the conservative side —
 * field engineers are opted OUT until an admin opts them in.
 */

const DEFAULTS = {
  enabled: true,
  rateLimitPerHour: 400,
  managerEnabled: true,
  storeKeeperEnabled: true,
  fieldEngineerEnabled: false,
} as const;

export async function getMcpSettings(): Promise<McpSettings> {
  const existing = await prisma.mcpSettings.findFirst();
  if (existing) return existing;
  return prisma.mcpSettings.create({ data: DEFAULTS });
}

export async function updateMcpSettings(
  patch: Partial<Pick<McpSettings, "enabled" | "rateLimitPerHour" | "managerEnabled" | "storeKeeperEnabled" | "fieldEngineerEnabled">>,
  updatedById: string,
): Promise<McpSettings> {
  const current = await getMcpSettings();
  return prisma.mcpSettings.update({ where: { id: current.id }, data: { ...patch, updatedById } });
}

/** Admin can always reach the settings page and always has MCP access — otherwise nobody could turn it back on. */
export function roleAllowed(settings: McpSettings, role: Role): boolean {
  if (role === "ADMIN") return true;
  if (!settings.enabled) return false;
  switch (role) {
    case "MANAGER":
      return settings.managerEnabled;
    case "STORE_KEEPER":
      return settings.storeKeeperEnabled;
    case "FIELD_ENGINEER":
      return settings.fieldEngineerEnabled;
    default:
      return false;
  }
}

/** Whether a role can see/use the /mcp page and MCP access at all, matching roleAllowed but also gating on the global switch for admin's own view (admin sees "disabled" state rather than being locked out). */
export function mcpVisibleTo(role: Role): boolean {
  return role === "ADMIN" || role === "MANAGER" || role === "STORE_KEEPER";
}
