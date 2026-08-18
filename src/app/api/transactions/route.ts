import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { transactionCreateSchema } from "@/lib/validation";
import {
  MOVEMENTS,
  carriesTransformer,
  checkEligibility,
  formatBatchRef,
  requiresSiteEngineer,
  type MovementKey,
} from "@/lib/transactions";
import { MOVEMENT_ACTION } from "@/lib/approvals";
import { openApproval } from "@/lib/approval-store";

/**
 * POST /api/transactions — raise a movement for one or many transformers.
 *
 * Nothing here touches the lifecycle chain. Raising a movement is a request,
 * not a fact about the asset: the transformer has not gone anywhere yet, and
 * writing an event now would put a journey on the chain that a manager might
 * still refuse. The chain is written on ARRIVAL, in the leg route, once the
 * movement has actually happened.
 *
 * Role is checked against the movement's own initiators list rather than a
 * hardcoded requireApiRole, so the eleven rules live in exactly one file.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiUser();

    const body = await request.json().catch(() => null);
    const input = transactionCreateSchema.parse(body);

    const movement = MOVEMENTS[input.movement as MovementKey];
    if (!movement) {
      return NextResponse.json(
        { error: "That is not a movement this system knows about.", fields: { movement: "Choose again." } },
        { status: 422 },
      );
    }

    if (!movement.initiators.includes(actor.role)) {
      return NextResponse.json(
        { error: `Your role cannot raise a ${movement.label} movement.` },
        { status: 403 },
      );
    }

    // Plate and driver name were already required here. The PHONE was not, and
    // that is the gap that mattered: when a lorry is three hours late with a
    // transformer on it, a name in a database is not something anybody can ring.
    //
    // Checked again on departure, where the details may also be corrected — see
    // the leg route. What is recorded there is the lorry that actually went,
    // not the one somebody expected when they filled this form in on Monday.
    if (carriesTransformer(movement)) {
      const missing = {
        vehiclePlate: input.vehiclePlate ? undefined : "Required.",
        driverName: input.driverName ? undefined : "Required.",
        driverPhone: input.driverPhone ? undefined : "Required — somebody has to be able to ring the lorry.",
      };
      if (Object.values(missing).some(Boolean)) {
        return NextResponse.json(
          {
            error:
              "A movement that carries a transformer must record the vehicle, the driver, and a number that reaches them.",
            fields: missing,
          },
          { status: 422 },
        );
      }
    }

    // A movement OUT of a site needs somebody physically there to disconnect
    // the unit and watch it onto the lorry. Until now the system did not record
    // who, so a keeper in an office could raise "Site to Workshop" and the
    // register would show a transformer leaving a site nobody attended.
    //
    // The check is here rather than in the schema because the schema cannot see
    // which movement was chosen — the catalog is what knows the origin is a
    // site, and deriving it from `from === "SITE"` means a twelfth movement out
    // of a site cannot accidentally escape the rule.
    let presentEngineerId: string | null = null;

    if (requiresSiteEngineer(movement)) {
      if (!input.presentEngineerId) {
        return NextResponse.json(
          {
            error:
              "Say which field engineer is at the site. A transformer cannot leave a pole without somebody standing at it.",
            fields: { presentEngineerId: "Required for any movement out of a site." },
          },
          { status: 422 },
        );
      }

      const engineer = await prisma.user.findUnique({
        where: { id: input.presentEngineerId },
        select: { id: true, name: true, role: true, active: true, region: true },
      });
      if (!engineer || engineer.role !== "FIELD_ENGINEER") {
        return NextResponse.json(
          { error: "That is not a field engineer.", fields: { presentEngineerId: "Choose a field engineer." } },
          { status: 422 },
        );
      }
      if (!engineer.active) {
        return NextResponse.json(
          { error: `${engineer.name}'s account is disabled.`, fields: { presentEngineerId: "Account disabled." } },
          { status: 422 },
        );
      }
      presentEngineerId = engineer.id;
    } else if (input.presentEngineerId) {
      // Silently ignoring it would leave a name on a movement with no site,
      // implying somebody attended something that never happened.
      return NextResponse.json(
        {
          error: `A ${movement.label} movement does not start at a site, so there is no engineer to be present at one.`,
          fields: { presentEngineerId: "Not applicable to this movement." },
        },
        { status: 422 },
      );
    }

    // A store or workshop destination is a row; a site, a manufacturer or scrap
    // is free text, because a pole is not a record.
    let toId: string | null = null;
    let toName = input.toName?.trim() ?? "";

    if (movement.to === "STORE" || movement.to === "WORKSHOP") {
      if (!input.toStoreId) {
        return NextResponse.json(
          { error: "Choose the destination.", fields: { toStoreId: "Required." } },
          { status: 422 },
        );
      }
      const dest = await prisma.store.findUnique({ where: { id: input.toStoreId } });
      if (!dest) {
        return NextResponse.json({ error: "That destination no longer exists." }, { status: 422 });
      }
      if (!dest.active) {
        return NextResponse.json(
          { error: `${dest.name} is disabled and cannot receive transformers.` },
          { status: 422 },
        );
      }
      if (dest.kind !== movement.to) {
        return NextResponse.json(
          { error: `${dest.name} is a ${dest.kind.toLowerCase()}, not a ${movement.to.toLowerCase()}.` },
          { status: 422 },
        );
      }
      toId = dest.id;
      toName = dest.name;
    } else if (!toName) {
      return NextResponse.json(
        { error: "Say where it is going.", fields: { toName: "Required." } },
        { status: 422 },
      );
    }

    const transformers = await prisma.transformer.findMany({
      where: { id: { in: input.transformerIds } },
      select: {
        id: true,
        gNumber: true,
        serialNumber: true,
        status: true,
        currentSiteName: true,
        currentStore: { select: { id: true, name: true, kind: true } },
      },
    });
    const byId = new Map(transformers.map((t) => [t.id, t]));

    // One batch reference per submission, so a lorry-load reads as one job even
    // though every unit keeps its own row.
    const year = new Date().getFullYear();
    const todayStart = new Date(new Date().toISOString().slice(0, 10));
    const batchesToday = await prisma.transactionRecord.findMany({
      where: { createdAt: { gte: todayStart }, batchRef: { not: null } },
      distinct: ["batchRef"],
      select: { batchRef: true },
    });
    const batchRef = formatBatchRef(year, batchesToday.length + 1);

    const created: { id: string; label: string }[] = [];
    const skipped: { id: string; label: string; reason: string }[] = [];

    for (const id of input.transformerIds) {
      const t = byId.get(id);
      const label = t?.gNumber ?? t?.serialNumber ?? id;

      if (!t) {
        skipped.push({ id, label, reason: "Not found." });
        continue;
      }
      // Exactly the same check the form ran, so the sentence the keeper read on
      // screen is the sentence they get back if they somehow submit anyway.
      const verdict = checkEligibility(
        movement,
        {
          status: t.status,
          heldByStoreId: t.currentStore?.id ?? null,
          heldByStoreName: t.currentStore?.name ?? null,
        },
        { role: actor.role, storeId: actor.storeId ?? null },
      );
      if (!verdict.ok) {
        skipped.push({ id, label, reason: verdict.reason });
        continue;
      }
      const open = await prisma.transactionRecord.findFirst({
        where: { transformerId: id, status: { in: ["PENDING_APPROVAL", "APPROVED", "IN_TRANSIT"] } },
        select: { id: true, status: true },
      });
      if (open) {
        skipped.push({ id, label, reason: `Already has an open movement (${open.status.toLowerCase().replace(/_/g, " ")}).` });
        continue;
      }

      // Origin is derived, never typed. Where a unit is now is a fact the system
      // already holds, and letting somebody type it is how two records disagree.
      const fromName =
        movement.from === "SITE"
          ? t.currentSiteName ?? "Site"
          : movement.from === "MANUFACTURER"
            ? "Manufacturer"
            : t.currentStore?.name ?? "Unknown store";

      const record = await prisma.transactionRecord.create({
        data: {
          transformerId: id,
          batchRef,
          movement: movement.key,
          fromType: movement.from,
          fromId: movement.from === "STORE" || movement.from === "WORKSHOP" ? t.currentStore?.id ?? null : null,
          fromName,
          toType: movement.to,
          toId,
          toName,
          purpose: movement.purpose,
          vehiclePlate: input.vehiclePlate || null,
          driverName: input.driverName || null,
          driverPhone: input.driverPhone || null,
          initiatedById: actor.id,
          presentEngineerId,
          // An engineer who raises their OWN site movement is already standing
          // there — asking them to confirm their own presence on a second
          // screen is a tap that teaches people the confirmation is a formality.
          // Anybody else raising it leaves this null, and the named engineer
          // has to confirm before the lorry may leave.
          presenceConfirmedAt:
            presentEngineerId && presentEngineerId === actor.id ? new Date() : null,
          presenceConfirmedById:
            presentEngineerId && presentEngineerId === actor.id ? actor.id : null,
          status: "PENDING_APPROVAL",
          notes: [input.reason, input.notes].filter(Boolean).join(" ") || null,
        },
      });

      await writeAudit({
        actorId: actor.id,
        action: "CREATE",
        targetType: "Transformer",
        targetId: id,
        targetLabel: label,
        details: `${actor.name} raised a ${movement.label} movement for ${label} (${fromName} → ${toName}), batch ${batchRef}. Awaiting approval.`,
      });

      // Raising a movement IS raising a request for approval — the movement
      // record already knows it is PENDING_APPROVAL. This opens the paperwork
      // alongside it so the person waiting has something to print and hand
      // over, and so the request appears in one queue with every other kind.
      //
      // It records; it does not gate. The TransactionRecord remains the
      // authority on whether this movement may proceed.
      await openApproval(
        {
          action: MOVEMENT_ACTION[movement.key],
          transformerId: id,
          transactionId: record.id,
          justification: [input.reason, input.notes].filter(Boolean).join(" ") || null,
          contextLabel: `${fromName} to ${toName}`,
        },
        actor,
      );

      created.push({ id: record.id, label });
    }

    return NextResponse.json(
      {
        batchRef,
        created,
        skipped,
        message: created.length
          ? `${batchRef}: ${created.length} ${created.length === 1 ? "movement" : "movements"} raised, awaiting approval.${skipped.length ? ` ${skipped.length} skipped.` : ""}`
          : "Nothing was raised.",
      },
      { status: created.length ? 201 : 422 },
    );
  } catch (error) {
    return apiError(error);
  }
}
