import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";

/**
 * Writes one row to the admin audit trail.
 *
 * Every administrative mutation — creating a user, changing a role, disabling
 * an account, editing a manufacturer — calls this. It is deliberately NOT the
 * custody chain: no admin action writes a LifecycleEvent, so the tamper-evident
 * history stays sealed. This answers a different question: who touched the
 * configuration of the system, and when.
 *
 * Accepts an optional transaction client so the audit row commits atomically
 * with the change it describes.
 */
export async function writeAudit(
  entry: {
    actorId: string;
    action: "CREATE" | "EDIT" | "DISABLE" | "ENABLE" | "UNLOCK" | "RESET_PIN" | "DELETE";
    targetType: "User" | "Manufacturer" | "Store" | "Transformer";
    targetId: string;
    targetLabel: string;
    details?: string;
    reason?: string;
  },
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await tx.auditLog.create({ data: entry });
}

/** Builds a "Changed X from A to B" summary from a set of field diffs. */
export function describeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const key of Object.keys(labels)) {
    if (key in after && before[key] !== after[key]) {
      parts.push(`${labels[key]} ${before[key] ?? "—"} → ${after[key] ?? "—"}`);
    }
  }
  return parts.join("; ");
}
