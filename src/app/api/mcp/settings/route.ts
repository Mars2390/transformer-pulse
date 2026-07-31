import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole, requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { getMcpSettings, updateMcpSettings, mcpVisibleTo } from "@/lib/mcp/settings";
import { writeAudit } from "@/lib/audit";

/** GET current MCP settings — any role the page is visible to. PATCH — admin only. */

export async function GET() {
  try {
    const user = await requireApiUser();
    if (!mcpVisibleTo(user.role)) return NextResponse.json({ error: "Not available for your role." }, { status: 403 });
    return NextResponse.json(await getMcpSettings());
  } catch (error) {
    return apiError(error);
  }
}

const PatchInput = z.object({
  enabled: z.boolean().optional(),
  rateLimitPerHour: z.number().int().min(1).max(10_000).optional(),
  managerEnabled: z.boolean().optional(),
  storeKeeperEnabled: z.boolean().optional(),
  fieldEngineerEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN");
    const patch = PatchInput.parse(await request.json());
    const updated = await updateMcpSettings(patch, actor.id);

    await writeAudit({
      actorId: actor.id,
      action: "EDIT",
      targetType: "McpSettings",
      targetId: updated.id,
      targetLabel: "MCP settings",
      details: `Updated: ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiError(error);
  }
}
