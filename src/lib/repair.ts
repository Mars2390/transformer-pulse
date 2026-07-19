import "server-only";
import { prisma } from "./prisma";
import { recordEvent } from "./events";
import type { SessionUser } from "./session";
import { REPAIR_ECONOMIC_LIMIT, REPEAT_REPAIR_LIMIT, estimateNewUnitCostKes } from "./repair-economics";

/**
 * The repair loop, and what happens when it fails.
 *
 * The important design decision here is that a failed repair is not the end of
 * the story — it is the START of a different one. A condemned transformer means
 * a site is off supply, and that site stays off until something is energised in
 * its place. Paper closes the fault when the unit is carted away. Customers
 * experience the opposite: for them the outage BEGINS there.
 *
 * So a REPAIR_FAILED automatically checks the store, and either finds a
 * replacement or records that there is none. Both outcomes are visible.
 */

// The arithmetic lives in repair-economics.ts, with no database import, so the
// repair-or-replace numbers can be checked without booting the application.
export { REPAIR_ECONOMIC_LIMIT, REPEAT_REPAIR_LIMIT, estimateNewUnitCostKes, assessRepairCost } from "./repair-economics";

export type StockCheck = {
  ratingKva: number;
  availableInStore: number;
  repairedAvailable: number;
  total: number;
  /** Units already promised to another site, so not really free. */
  reserved: number;
  candidates: { id: string; gNumber: string | null; serialNumber: string; status: string; storeName: string | null }[];
};

/**
 * What is actually free of a given rating.
 *
 * "Free" is the operative word: a transformer sitting in a store that is
 * already reserved against another site is not stock, it is somebody else's
 * transformer. Counting it produces the promise that gets broken at a roadside
 * with a crane already hired.
 */
export async function checkStock(ratingKva: number, region?: string | null): Promise<StockCheck> {
  const reservedIds = (
    await prisma.allocation.findMany({
      where: { status: { in: ["RESERVED", "DISPATCHED"] } },
      select: { transformerId: true },
    })
  ).map((a) => a.transformerId);

  const candidates = await prisma.transformer.findMany({
    where: {
      ratingKva,
      status: { in: ["IN_STORE", "REPAIRED"] },
      id: { notIn: reservedIds.length ? reservedIds : ["__none__"] },
      ...(region ? { region } : {}),
    },
    select: {
      id: true, gNumber: true, serialNumber: true, status: true,
      currentStore: { select: { name: true } },
    },
    orderBy: { status: "asc" },
  });

  return {
    ratingKva,
    availableInStore: candidates.filter((c) => c.status === "IN_STORE").length,
    repairedAvailable: candidates.filter((c) => c.status === "REPAIRED").length,
    total: candidates.length,
    reserved: reservedIds.length,
    candidates: candidates.map((c) => ({
      id: c.id, gNumber: c.gNumber, serialNumber: c.serialNumber,
      status: c.status, storeName: c.currentStore?.name ?? null,
    })),
  };
}

export type RepairOutcomeInput = {
  faultCauseConfirmed: string;
  repairActions?: string;
  partsReplaced?: string;
  repairCostKes?: number;
  repairWarrantyMonths?: number;
  workshopTechnician?: string;
  notes?: string;
  successful: boolean;
  failureReason?: string;
  /** Post-repair test values. The state machine requires these on REPAIRED. */
  test?: {
    oilBdvKv?: number;
    insulationResistanceHvMohm?: number;
    insulationResistanceLvMohm?: number;
    turnsRatioDeviationPct?: number;
    passed: boolean;
    remarks?: string;
  };
};

export type RepairOutcomeResult = {
  repairId: string;
  status: string;
  turnaroundDays: number | null;
  economicWarning: string | null;
  repeatWarning: string | null;
  /** Only when the repair failed. */
  stock: StockCheck | null;
  supplyRequestId: string | null;
  alertsRaised: number;
};

/**
 * Close a repair, successfully or not, and deal with the consequences.
 */
export async function closeRepair(
  repairId: string,
  input: RepairOutcomeInput,
  actor: SessionUser,
): Promise<RepairOutcomeResult> {
  const repair = await prisma.repairRecord.findUnique({
    where: { id: repairId },
    include: {
      transformer: {
        select: {
          id: true, gNumber: true, serialNumber: true, ratingKva: true,
          region: true, currentSiteName: true, substationCode: true,
          repairCount: true, status: true,
        },
      },
    },
  });
  if (!repair) throw new Error("Repair record not found.");

  const tx = repair.transformer;
  const label = tx.gNumber ?? tx.serialNumber;
  const completedAt = new Date();
  const turnaroundDays = Math.round(
    (completedAt.getTime() - repair.receivedAtWorkshop.getTime()) / 86_400_000,
  );

  // --- Decision support, not decisions -------------------------------------
  // These are surfaced to a human. The system does not refuse an uneconomic
  // repair — sometimes there is nothing else to give the site — but nobody gets
  // to say afterwards that the numbers were not in front of them.
  let economicWarning: string | null = null;
  if (input.repairCostKes) {
    const newUnitEstimate = estimateNewUnitCostKes(tx.ratingKva);
    const ratio = input.repairCostKes / newUnitEstimate;
    if (ratio > REPAIR_ECONOMIC_LIMIT) {
      economicWarning =
        `This repair cost KES ${Math.round(input.repairCostKes).toLocaleString()}, which is ` +
        `${Math.round(ratio * 100)}% of a new ${tx.ratingKva} kVA unit (about KES ` +
        `${newUnitEstimate.toLocaleString()}). Above ${REPAIR_ECONOMIC_LIMIT * 100}% a replacement is usually the better buy.`;
    }
  }

  const nextRepairCount = tx.repairCount + 1;
  const repeatWarning =
    nextRepairCount >= REPEAT_REPAIR_LIMIT
      ? `${label} has now been through a workshop ${nextRepairCount} times. A unit failing this often is telling you something a single repair record cannot.`
      : null;

  await prisma.repairRecord.update({
    where: { id: repairId },
    data: {
      faultCauseConfirmed: input.faultCauseConfirmed,
      repairActions: input.repairActions ?? null,
      partsReplaced: input.partsReplaced ?? null,
      repairCostKes: input.repairCostKes ?? null,
      repairCompletedAt: completedAt,
      repairWarrantyMonths: input.repairWarrantyMonths ?? 3,
      repairSuccessful: input.successful,
      failureReason: input.successful ? null : (input.failureReason ?? "Not stated"),
      workshopTechnician: input.workshopTechnician ?? actor.name,
      notes: input.notes ?? null,
    },
  });

  await prisma.transformer.update({
    where: { id: tx.id },
    data: { repairCount: nextRepairCount },
  });

  const alerts: { transformerId: string; type: "REPAIR_COMPLETED" | "REPAIR_FAILED" | "AWAITING_REPLACEMENT"; severity: "INFO" | "WARNING" | "CRITICAL"; region: string | null; message: string }[] = [];

  // --- Successful --------------------------------------------------------
  if (input.successful) {
    await recordEvent(
      tx.id,
      {
        type: "REPAIRED",
        occurredAt: completedAt,
        notes:
          `Repair complete after ${turnaroundDays} day(s). ` +
          `Confirmed cause: ${input.faultCauseConfirmed}. ` +
          (input.repairActions ? `Work: ${input.repairActions}. ` : "") +
          (input.partsReplaced ? `Parts: ${input.partsReplaced}. ` : "") +
          (input.repairCostKes ? `Cost KES ${Math.round(input.repairCostKes).toLocaleString()}. ` : "") +
          `Workshop warranty ${input.repairWarrantyMonths ?? 3} months.`,
        // The state machine requires this. A repair claimed without a test is
        // a repair nobody can stand behind.
        test: input.test
          ? { ...input.test, stage: "POST_FAULT" as const }
          : undefined,
      },
      actor,
    );

    alerts.push({
      transformerId: tx.id,
      type: "REPAIR_COMPLETED",
      severity: "INFO",
      region: tx.region,
      message:
        `${label} repaired in ${turnaroundDays} day(s)` +
        (input.repairCostKes ? ` for KES ${Math.round(input.repairCostKes).toLocaleString()}` : "") +
        `. Ready to return to store.`,
    });

    if (alerts.length) await prisma.alert.createMany({ data: alerts });

    return {
      repairId, status: "REPAIRED", turnaroundDays,
      economicWarning, repeatWarning, stock: null, supplyRequestId: null,
      alertsRaised: alerts.length,
    };
  }

  // --- Failed ------------------------------------------------------------
  await recordEvent(
    tx.id,
    {
      type: "REPAIR_FAILED",
      occurredAt: completedAt,
      notes:
        `Condemned after ${turnaroundDays} day(s) at the workshop. ` +
        `Confirmed cause: ${input.faultCauseConfirmed}. ` +
        `Beyond repair: ${input.failureReason ?? "not stated"}.` +
        (input.repairCostKes ? ` KES ${Math.round(input.repairCostKes).toLocaleString()} spent before condemning.` : ""),
    },
    actor,
  );

  alerts.push({
    transformerId: tx.id,
    type: "REPAIR_FAILED",
    severity: "WARNING",
    region: tx.region,
    message: `${label} condemned beyond repair: ${input.failureReason ?? "not stated"}.`,
  });

  // The site is now the problem, not the transformer. Check for a replacement.
  const stock = await checkStock(tx.ratingKva, tx.region);

  let supplyRequestId: string | null = null;
  if (tx.currentSiteName || tx.substationCode) {
    const request = await createSupplyRequest(
      {
        siteName: tx.currentSiteName ?? `Substation ${tx.substationCode}`,
        substationCode: tx.substationCode,
        region: tx.region,
        ratingKvaNeeded: tx.ratingKva,
        reason: "TRANSFORMER_FAILED",
        failedTransformerId: tx.id,
        urgency: "EMERGENCY",
        notes: `Raised automatically when ${label} was condemned beyond repair.`,
      },
      actor,
    );
    supplyRequestId = request.id;
  }

  if (stock.total === 0) {
    alerts.push({
      transformerId: tx.id,
      type: "AWAITING_REPLACEMENT",
      severity: "CRITICAL",
      region: tx.region,
      message:
        `${tx.currentSiteName ?? tx.substationCode ?? "A site"} is off supply and there is no free ` +
        `${tx.ratingKva} kVA unit${tx.region ? ` in ${tx.region}` : ""}. Procurement required.`,
    });
  }

  if (alerts.length) await prisma.alert.createMany({ data: alerts });

  return {
    repairId, status: "BEYOND_REPAIR", turnaroundDays,
    economicWarning, repeatWarning, stock, supplyRequestId,
    alertsRaised: alerts.length,
  };
}

// ---------------------------------------------------------------------------
// Supply requests and allocation
// ---------------------------------------------------------------------------

export type SupplyRequestInput = {
  siteName: string;
  substationCode?: string | null;
  region?: string | null;
  county?: string | null;
  lat?: number | null;
  lng?: number | null;
  landmark?: string | null;
  ratingKvaNeeded: number;
  reason: "TRANSFORMER_FAILED" | "NO_SUPPLY_AT_SITE" | "CAPACITY_UPGRADE" | "RELOCATION";
  failedTransformerId?: string | null;
  customersAffected?: number | null;
  urgency?: "NORMAL" | "HIGH" | "EMERGENCY";
  notes?: string | null;
};

/** Sequential per year, so a reference can be read over a radio. */
async function nextReference(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const latest = await prisma.supplyRequest.findFirst({
    where: { reference: { startsWith: `SR-${year}-` } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const n = latest ? Number(latest.reference.split("-")[2] ?? 0) : 0;
  return `SR-${year}-${String(n + 1).padStart(4, "0")}`;
}

export async function createSupplyRequest(input: SupplyRequestInput, actor: SessionUser) {
  const request = await prisma.supplyRequest.create({
    data: {
      reference: await nextReference(),
      siteName: input.siteName,
      substationCode: input.substationCode ?? null,
      region: input.region ?? actor.region ?? null,
      county: input.county ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      landmark: input.landmark ?? null,
      ratingKvaNeeded: input.ratingKvaNeeded,
      reason: input.reason,
      failedTransformerId: input.failedTransformerId ?? null,
      customersAffected: input.customersAffected ?? null,
      urgency: input.urgency ?? "NORMAL",
      raisedById: actor.id,
      notes: input.notes ?? null,
      status: "SUBMITTED",
    },
  });

  // Alert.transformerId is required, so a request for a site that has never had
  // a transformer (NO_SUPPLY_AT_SITE) cannot carry one. Those show on the
  // supply-request queue instead, which is where they belong anyway.
  if (input.failedTransformerId) await prisma.alert.create({
    data: {
      transformerId: input.failedTransformerId,
      type: "SUPPLY_REQUEST_RAISED",
      severity: input.urgency === "EMERGENCY" ? "CRITICAL" : "WARNING",
      region: request.region,
      message:
        `${request.reference}: ${input.siteName} needs a ${input.ratingKvaNeeded} kVA transformer` +
        (input.customersAffected ? ` — ${input.customersAffected} customers off supply` : "") +
        `. Awaiting approval.`,
    },
  });

  return request;
}

/**
 * Reserve a specific transformer against an approved request.
 *
 * The whole value of this function is the race it prevents. Two engineers, two
 * phone calls, one transformer: without an atomic check-and-hold, both are told
 * yes and the second discovers the truth at the roadside. The reservation is
 * taken inside a transaction that re-checks availability, so the loser is told
 * no in an office instead of on site.
 */
export async function reserveTransformer(
  requestId: string,
  transformerId: string,
  plannedInstallDate: Date | null,
  actor: SessionUser,
) {
  return prisma.$transaction(async (db) => {
    const request = await db.supplyRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new Error("Supply request not found.");
    if (request.status !== "APPROVED" && request.status !== "ALLOCATED") {
      throw new Error("This request has not been approved yet. A manager must approve it before a transformer is committed.");
    }

    const tx = await db.transformer.findUnique({
      where: { id: transformerId },
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, status: true },
    });
    if (!tx) throw new Error("Transformer not found.");
    if (tx.status !== "IN_STORE" && tx.status !== "REPAIRED") {
      throw new Error(`That transformer is ${tx.status.toLowerCase().replace(/_/g, " ")} and cannot be allocated.`);
    }
    if (tx.ratingKva !== request.ratingKvaNeeded) {
      throw new Error(
        `Rating mismatch: the site needs ${request.ratingKvaNeeded} kVA and this unit is ${tx.ratingKva} kVA.`,
      );
    }

    // Re-check inside the transaction. This is the line that prevents the
    // double-promise.
    const existing = await db.allocation.findFirst({
      where: { transformerId, status: { in: ["RESERVED", "DISPATCHED"] } },
      select: { id: true, request: { select: { reference: true, siteName: true } } },
    });
    if (existing) {
      throw new Error(
        `That transformer is already reserved for ${existing.request.siteName} (${existing.request.reference}).`,
      );
    }

    const allocation = await db.allocation.create({
      data: {
        requestId,
        transformerId,
        allocatedById: actor.id,
        plannedInstallDate,
        status: "RESERVED",
      },
    });

    await db.supplyRequest.update({ where: { id: requestId }, data: { status: "ALLOCATED" } });

    return { allocation, transformer: tx, request };
  });
}
