import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { listActiveDatasets, deleteDatasets, clearAllDatasets } from "@/lib/emdis-datasets";
import { flagStoredDuplicates, scanStoredDuplicates, collapseRedundantAlerts } from "@/lib/emdis-duplicates";

/**
 * Load dataset management.
 *
 *   GET                                 the datasets feeding the analysis
 *   GET    ?duplicates=1                the duplicate scan, read-only
 *   POST   {action:"scan"}              run the scan and record its flags
 *   POST   {action:"collapse-alerts"}   remove alerts that repeat a finding
 *   DELETE ?id=...                      remove one dataset
 *   DELETE ?all=1                       remove every dataset  (ADMIN only)
 *
 * Clearing everything is admin-only and single-purpose. It is the one action
 * here that cannot be undone from the interface and cannot be scoped to a
 * mistake — a manager who meant to remove one bad upload has ?id= for that.
 */

export async function GET(request: Request) {
  try {
    await requireApiRole("ADMIN", "MANAGER");
    const url = new URL(request.url);

    if (url.searchParams.get("duplicates")) {
      const scan = await scanStoredDuplicates();
      return NextResponse.json(scan);
    }

    return NextResponse.json({ datasets: await listActiveDatasets() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("ADMIN", "MANAGER");
    const body = await request.json().catch(() => ({}));

    // Removes alert rows that repeat a finding word for word, keeping one of
    // each. Separate from the scan because it deletes, and a button that
    // reports and a button that deletes should not be the same button.
    if (body.action === "collapse-alerts") {
      const result = await collapseRedundantAlerts();
      if (result.removed) {
        await writeAudit({
          actorId: actor.id,
          action: "DELETE",
          targetType: "EmdisDataset",
          targetId: "ALERTS",
          targetLabel: "Repeated load alerts",
          details:
            `Collapsed ${result.groups} group(s) of word-for-word identical load alerts, ` +
            `removing ${result.removed} redundant row(s). One of each finding kept.`,
        });
      }
      return NextResponse.json(result);
    }

    if (body.action !== "scan") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const scan = await flagStoredDuplicates();
    return NextResponse.json({
      ...scan,
      // Named so the screen can say who ran it; the scan itself writes only
      // flags, so this is not audited as a mutation of the register.
      scannedBy: actor.name,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const all = url.searchParams.get("all");
    const id = url.searchParams.get("id");

    if (all) {
      const actor = await requireApiRole("ADMIN");
      const result = await clearAllDatasets();
      await writeAudit({
        actorId: actor.id,
        action: "DELETE",
        targetType: "EmdisDataset",
        targetId: "ALL",
        targetLabel: "All load datasets",
        details:
          `Cleared all load data: ${result.deleted} dataset(s), ` +
          `${result.readingsRemoved.toLocaleString()} readings, ` +
          `${result.alertsWithdrawn} alert(s) withdrawn, ` +
          `${result.rescored.length} transformer(s) rescored.`,
      });
      return NextResponse.json(result);
    }

    if (!id) return NextResponse.json({ error: "No dataset given." }, { status: 400 });

    const actor = await requireApiRole("ADMIN", "MANAGER");
    const result = await deleteDatasets([id]);
    if (!result.deleted) {
      return NextResponse.json({ error: "That dataset no longer exists." }, { status: 404 });
    }

    await writeAudit({
      actorId: actor.id,
      action: "DELETE",
      targetType: "EmdisDataset",
      targetId: id,
      targetLabel: id,
      details:
        `Deleted load dataset: ${result.readingsRemoved.toLocaleString()} readings, ` +
        `${result.alertsWithdrawn} alert(s) withdrawn, ` +
        `${result.rescored.length} transformer(s) rescored.`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
