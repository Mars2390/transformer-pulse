import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { computeEventHash } from "@/lib/chain";
import { DATA_SOURCE_META } from "@/lib/format";
import type { ImportRowData } from "@/lib/import-rows";
import type { EventType, TransformerStatus } from "@/generated/prisma/enums";

/**
 * POST /api/import/commit — write one batch of validated rows.
 *
 * The client sends batches (not the whole file) so it can show progress and no
 * single request risks timing out on a slow connection.
 *
 * Every imported transformer gets a real event chain, not just a row: the
 * sequence is chosen from the imported status so the last event's toStatus
 * always equals the transformer's status, and the hashes chain from a genesis
 * with prevHash = null. An imported unit therefore verifies green like any
 * other — while its notes say plainly that it is a backfilled baseline, not an
 * observed field event.
 */

type Body = {
  rows: ImportRowData[];
  fileName: string;
  onDuplicate?: "skip" | "update";
  isFinalBatch?: boolean;
  totals?: { imported: number; updated: number; skipped: number; failed: number };
};

/**
 * Which events an imported status implies, in order.
 *
 * A row that states its provenance gets ONE genesis event and nothing else.
 * The synthesised store-receipt-then-installation history below is a reasonable
 * reconstruction for a unit KPLC really did receive and install — the paperwork
 * exists, it is just not in this system. It would be a fabrication for a
 * transformer found on a map: there was no store receipt, no dispatch, and no
 * installation anybody here witnessed. Inventing that chain would put false
 * events under a real hash, which is precisely what this system exists to make
 * impossible.
 */
function eventPlan(
  status: string,
  dataSource?: string | null,
): { type: EventType; to: TransformerStatus }[] {
  if (dataSource) {
    return [{ type: "ONBOARDED_EXISTING", to: "IN_FIELD" }];
  }
  switch (status) {
    case "IN_FIELD":
      return [{ type: "RECEIVED_AT_STORE", to: "IN_STORE" }, { type: "INSTALLED", to: "IN_FIELD" }];
    case "IN_TRANSIT":
      return [{ type: "RECEIVED_AT_STORE", to: "IN_STORE" }, { type: "DISPATCHED", to: "IN_TRANSIT" }];
    case "FAULTY":
      return [
        { type: "RECEIVED_AT_STORE", to: "IN_STORE" },
        { type: "INSTALLED", to: "IN_FIELD" },
        { type: "FAULT_REPORTED", to: "FAULTY" },
      ];
    case "RETURNED":
      return [
        { type: "RECEIVED_AT_STORE", to: "IN_STORE" },
        { type: "RETURNED_TO_MANUFACTURER", to: "RETURNED" },
      ];
    default:
      return [{ type: "RECEIVED_AT_STORE", to: "IN_STORE" }];
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiRole("STORE_KEEPER", "ADMIN");
    const body = (await request.json()) as Body;
    const rows = body.rows ?? [];
    const onDuplicate = body.onDuplicate ?? "skip";

    let imported = 0, updated = 0, skipped = 0;
    const failures: { serialNumber: string; reason: string }[] = [];

    // Two lookups hoisted out of the row loop. Doing them per row cost two
    // extra round trips to a remote database for every transformer — on a
    // 1000-row import that alone is thousands of needless queries.
    const [makers, alreadyHere] = await Promise.all([
      prisma.manufacturer.findMany({ select: { id: true, name: true, warrantyMonths: true } }),
      prisma.transformer.findMany({
        where: { serialNumber: { in: rows.map((r) => r.serialNumber).filter(Boolean) } },
        select: { id: true, serialNumber: true },
      }),
    ]);
    const makerById = new Map(makers.map((m) => [m.id, m]));
    const existingBySerial = new Map(alreadyHere.map((t) => [t.serialNumber, t]));

    for (const row of rows) {
      try {
        if (!row.serialNumber || !row.manufacturerId || row.ratingKva == null) {
          failures.push({ serialNumber: row.serialNumber || "(blank)", reason: "Missing a required field" });
          continue;
        }

        const existing = existingBySerial.get(row.serialNumber);

        if (existing) {
          if (onDuplicate === "skip") { skipped++; continue; }
          // Update fills in the spec only. It never touches the existing chain.
          await prisma.transformer.update({
            where: { id: existing.id },
            data: specFields(row),
          });
          updated++;
          continue;
        }

        const manufacturer = makerById.get(row.manufacturerId);
        if (!manufacturer) {
          failures.push({ serialNumber: row.serialNumber, reason: "Manufacturer no longer exists" });
          continue;
        }

        const installedAt = row.installationDateISO ? new Date(row.installationDateISO) : null;
        // Warranty starts at delivery. Where the sheet only gives an install
        // date, that is the best evidence we have of when KPLC took the unit.
        const baseDate = installedAt ?? new Date();

        await prisma.$transaction(async (tx) => {
          const created = await tx.transformer.create({
            data: {
              serialNumber: row.serialNumber,
              gNumber: row.gNumber || null,
              manufacturerId: row.manufacturerId!,
              ...specFields(row),
              // An onboarded unit claims no warranty. We do not know when KPLC
              // took delivery, and a start date we invented would become a
              // claim against a manufacturer that nobody can substantiate.
              warrantyMonths: row.dataSource ? 0 : manufacturer.warrantyMonths,
              warrantyStart: row.dataSource ? null : baseDate,
              // A spreadsheet must not hand itself a status the maker-checker
              // flow exists to control. PENDING_APPROVAL and REJECTED are
              // reachable only through the receive form and the approvals API;
              // a row claiming either is parked in PENDING_APPROVAL for a human
              // rather than trusted.
              status: row.dataSource
                ? "IN_FIELD"
                : row.status === "PENDING_APPROVAL" || row.status === "REJECTED"
                  ? "PENDING_APPROVAL"
                  : (row.status as TransformerStatus),
              currentStoreId: !row.dataSource && row.status === "IN_STORE" ? row.storeId : null,
              currentLat: row.dataSource || row.status === "IN_FIELD" || row.status === "FAULTY" ? row.lat : null,
              currentLng: row.dataSource || row.status === "IN_FIELD" || row.status === "FAULTY" ? row.lng : null,
              currentSiteName: row.locationDescription,
              region: row.region,
              dataSource: row.dataSource,
              mountingType: row.mountingType,
              // Not commissioned by us — we do not know when it was energised.
              commissionDate: row.dataSource ? null : installedAt,
            },
          });

          const plan = eventPlan(row.status, row.dataSource);
          let prevHash: string | null = null;
          let fromStatus: TransformerStatus | null = null;

          for (let i = 0; i < plan.length; i++) {
            const step = plan[i];
            // Onboarded units carry their position on the genesis event itself —
            // it is the only thing we actually know about them.
            const isLocated = step.type === "INSTALLED" || step.type === "ONBOARDED_EXISTING";
            const occurredAt = new Date(baseDate.getTime() + i * 1000); // keep order stable
            const notes =
              step.type === "ONBOARDED_EXISTING"
                ? `Bulk onboarded from ${body.fileName} on ${new Date().toLocaleDateString("en-GB")}. ` +
                  `Data source: ${DATA_SOURCE_META[row.dataSource!]?.label ?? row.dataSource}. ` +
                  `Requires physical inspection to verify.`
                : i === 0
                  ? `Imported from ${body.fileName} on ${new Date().toLocaleDateString("en-GB")}. Baseline record — not an observed field event.`
                  : `Imported baseline: recorded as ${step.to.replace(/_/g, " ").toLowerCase()}.`;

            const hash = computeEventHash(prevHash, {
              transformerId: created.id,
              type: step.type,
              toStatus: step.to,
              userId: actor.id,
              occurredAt,
              lat: isLocated ? row.lat : null,
              lng: isLocated ? row.lng : null,
              vehiclePlate: step.type === "DISPATCHED" ? row.vehiclePlate : null,
              driverName: step.type === "DISPATCHED" ? row.driverName : null,
              notes,
            });

            await tx.lifecycleEvent.create({
              data: {
                transformerId: created.id,
                type: step.type,
                fromStatus,
                toStatus: step.to,
                userId: actor.id,
                occurredAt,
                lat: isLocated ? row.lat : null,
                lng: isLocated ? row.lng : null,
                locationName: isLocated ? row.locationDescription : null,
                vehiclePlate: step.type === "DISPATCHED" ? row.vehiclePlate : null,
                driverName: step.type === "DISPATCHED" ? row.driverName : null,
                driverPhone: step.type === "DISPATCHED" ? row.driverPhone : null,
                destination: step.type === "DISPATCHED" ? row.locationDescription : null,
                photoUrls: [],
                notes,
                prevHash,
                hash,
              },
            });

            prevHash = hash;
            fromStatus = step.to;
          }

          // Any test readings the sheet carried, attached to the unit.
          if (row.oilBdvKv != null || row.irHv != null || row.irLv != null) {
            await tx.testRecord.create({
              data: {
                transformerId: created.id,
                stage: "STORE_INTAKE",
                testedById: actor.id,
                testedAt: baseDate,
                oilBdvKv: row.oilBdvKv,
                insulationResistanceHvMohm: row.irHv,
                insulationResistanceLvMohm: row.irLv,
                passed: true,
                remarks: `Imported from ${body.fileName}.`,
              },
            });
          }

          await tx.transformer.update({ where: { id: created.id }, data: { lastEventHash: prevHash } });
        });

        imported++;
      } catch (rowError) {
        const message = rowError instanceof Error ? rowError.message : "Unexpected error";
        failures.push({
          serialNumber: row.serialNumber || "(blank)",
          reason: message.includes("Unique constraint") ? "Serial number or G-Number already in use" : message.slice(0, 140),
        });
      }
    }

    // Log the whole import once, on the last batch.
    if (body.isFinalBatch) {
      const t = body.totals ?? { imported: 0, updated: 0, skipped: 0, failed: 0 };
      await writeAudit({
        actorId: actor.id,
        action: "CREATE",
        targetType: "Transformer",
        targetId: "bulk-import",
        targetLabel: body.fileName,
        details: `Bulk import: ${t.imported + imported} created, ${t.updated + updated} updated, ${t.skipped + skipped} skipped, ${t.failed + failures.length} failed`,
      });
    }

    return NextResponse.json({ imported, updated, skipped, failed: failures.length, failures });
  } catch (error) {
    return apiError(error);
  }
}

/** The spec/nameplate columns, shared by create and update. */
function specFields(row: ImportRowData) {
  return {
    ratingKva: row.ratingKva!,
    primaryKv: row.primaryKv ?? 11,
    secondaryKv: row.secondaryKv ?? 0.415,
    phases: row.phases === 1 ? 1 : 3,
    coolingType: row.coolingType || "ONAN",
    impedancePct: row.impedancePct,
    vectorGroup: row.vectorGroup,
    oilVolumeLitres: row.oilVolumeLitres,
    yearOfManufacture: row.yearOfManufacture ?? new Date().getFullYear(),
    frequencyHz: row.frequencyHz,
    duty: row.duty,
    standardRef: row.standardRef,
    hvInsulationLevelKv: row.hvInsulationLevelKv,
    tempRiseOilC: row.tempRiseOilC,
    tempRiseWindingC: row.tempRiseWindingC,
    tempClass: row.tempClass,
    maxAmbientTempC: row.maxAmbientTempC,
    insulationOilType: row.insulationOilType,
    oilWeightKg: row.oilWeightKg,
    totalWeightKg: row.totalWeightKg,
    tapRange: row.tapRange,
  };
}
