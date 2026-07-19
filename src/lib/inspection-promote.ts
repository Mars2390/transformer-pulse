import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { computeEventHash } from "./chain";

/**
 * Promoting staged inspections into real transformers.
 *
 * The register describes assets that genuinely exist and were genuinely
 * visited — a lineman stood under each one. What it does not do is describe
 * them completely, and this file's job is to draw the line between "incomplete
 * but usable" and "so incomplete that a record would mislead".
 *
 * Two fields are non-negotiable, and both for the same reason: they are inputs
 * to calculations the system will later present as engineering fact.
 *
 *   RATING drives every loading figure. Promote a unit with a guessed 200 kVA
 *   and the overload analysis reports a guess as a measurement. That is the
 *   exact failure this system exists to prevent, so a unit whose rating no
 *   inspection recorded is left staged.
 *
 *   YEAR drives the age term in the health score. Defaulting an unknown year to
 *   today makes a 1970 transformer score as new — optimistic in the one
 *   direction that gets people hurt.
 *
 * Everything else may be missing. An unreadable serial, a defaced G-Number, a
 * blank manufacturer: none of those make the record dishonest, they just make
 * it thin, and a thin record of a real transformer beats no record at all.
 */

export type StagedUnit = {
  /** Stable key: G-Number if readable, else serial, else substation code. */
  key: string;
  inspectionIds: string[];
  reportIds: number[];

  gNumber: string | null;
  serial: string | null;
  substationCode: string;
  substationName: string | null;
  make: string | null;
  ratingKva: number | null;
  yom: number | null;
  region: string | null;
  county: string | null;
  locationNote: string | null;
  lastInspectedOn: Date;
  inspectorRef: string;
  structure: string | null;
  visits: number;

  /** Empty when this unit can be promoted. */
  blockers: string[];
  warnings: string[];
};

const normaliseG = (raw: string | null): string | null => {
  if (!raw) return null;
  const s = raw.replace(/^G[\s-]?/i, "").replace(/\s+/g, "");
  return /^\d{2,9}$/.test(s) ? s : null;
};

/**
 * Group staged inspections into the transformers they describe.
 *
 * 1,536 visits cover roughly 1,150 units — repeat visits are the norm. Where
 * visits disagree, the NEWEST reading wins for condition (it is the most recent
 * observation) and the newest NON-NULL value wins for identity (an inspector
 * who could read the plate beats one who could not, regardless of order).
 */
export async function loadStagedUnits(): Promise<StagedUnit[]> {
  const rows = await prisma.substationInspection.findMany({
    where: { transformerId: null },
    orderBy: { inspectedOn: "asc" },
  });

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normaliseG(r.gNumberAsRecorded) ?? r.serialAsRecorded ?? r.substationCode;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const units: StagedUnit[] = [];

  for (const [key, visits] of groups) {
    // Ascending by date, so "last non-null wins" is also "most recent wins".
    const pick = <T>(f: (r: (typeof visits)[0]) => T | null | undefined): T | null => {
      let out: T | null = null;
      for (const v of visits) {
        const val = f(v);
        if (val != null && val !== "") out = val as T;
      }
      return out;
    };

    const newest = visits[visits.length - 1];
    const gNumber = pick((r) => normaliseG(r.gNumberAsRecorded));
    const serial = pick((r) => r.serialAsRecorded);
    const ratingKva = pick((r) => r.ratingKvaAsRecorded);
    const yom = pick((r) => r.yomAsRecorded);
    const make = pick((r) => r.makeAsRecorded);

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (ratingKva == null) {
      blockers.push("No inspection recorded a usable rating — every loading figure would be a guess");
    }
    if (yom == null) {
      blockers.push("No inspection recorded a usable year — the age term in the health score would be invented");
    }

    if (!gNumber) warnings.push("G-Number not readable on the plate — a staged number will be issued");
    if (!serial) warnings.push("Serial not readable from the ground");
    if (!make) warnings.push("Manufacturer not recorded");

    // Identity disagreements across visits, carried forward for the conflict
    // report rather than silently collapsed by the pick above.
    const ratings = new Set(visits.map((v) => v.ratingKvaAsRecorded).filter((x) => x != null));
    const makes = new Set(visits.map((v) => v.makeAsRecorded).filter((x) => x));
    if (ratings.size > 1) warnings.push(`Visits disagree on rating: ${[...ratings].join(" vs ")} kVA`);
    if (makes.size > 1) warnings.push(`Visits disagree on manufacturer: ${[...makes].join(" vs ")}`);

    units.push({
      key,
      inspectionIds: visits.map((v) => v.id),
      reportIds: visits.map((v) => v.reportId),
      gNumber,
      serial,
      substationCode: newest.substationCode,
      substationName: pick((r) => r.substationName),
      make,
      ratingKva,
      yom,
      region: pick((r) => r.region),
      county: pick((r) => r.county),
      locationNote: pick((r) => r.locationNote),
      lastInspectedOn: newest.inspectedOn,
      inspectorRef: newest.inspectorRef,
      structure: newest.structure,
      visits: visits.length,
      blockers,
      warnings,
    });
  }

  // Promotable first, then by most recently inspected.
  units.sort((a, b) => {
    if (a.blockers.length !== b.blockers.length) return a.blockers.length - b.blockers.length;
    return b.lastInspectedOn.getTime() - a.lastInspectedOn.getTime();
  });

  return units;
}

// --- Promotion ---------------------------------------------------------------

export type PromoteResult = {
  promoted: number;
  skipped: number;
  failed: number;
  details: { key: string; outcome: "PROMOTED" | "SKIPPED" | "FAILED"; label?: string; reason?: string }[];
};

/** Find or create the manufacturer named on the form. */
async function manufacturerFor(name: string | null): Promise<string> {
  const clean = (name ?? "").trim().toUpperCase();
  const target = clean || "UNKNOWN";

  const found = await prisma.manufacturer.findFirst({
    where: { name: { equals: target, mode: "insensitive" } },
    select: { id: true },
  });
  if (found) return found.id;

  const created = await prisma.manufacturer.create({
    // Zero warranty months on purpose: these are units of unknown provenance
    // and inventing a warranty term would create a claim nobody can support.
    data: { name: target, warrantyMonths: 0, country: null },
    select: { id: true },
  });
  return created.id;
}

/**
 * Promote one batch.
 *
 * Batched because a thousand transformers each with a genesis event is a
 * thousand write transactions, and a single request that runs for minutes is a
 * request that times out halfway with no way to tell what landed.
 */
export async function promoteUnits(
  keys: string[],
  actor: { id: string; name: string },
): Promise<PromoteResult> {
  const all = await loadStagedUnits();
  const wanted = all.filter((u) => keys.includes(u.key));

  const result: PromoteResult = { promoted: 0, skipped: 0, failed: 0, details: [] };
  const year = new Date().getFullYear();

  for (const unit of wanted) {
    if (unit.blockers.length) {
      result.skipped++;
      result.details.push({ key: unit.key, outcome: "SKIPPED", reason: unit.blockers[0] });
      continue;
    }

    try {
      // --- G-Number ---------------------------------------------------------
      // A readable plate number is used as-is. An unreadable one gets an
      // explicitly temporary number: it reads as provisional to a human and
      // stays unique to the database, and the field engineer replaces it with
      // the real one when the plate is cleaned or the unit is re-stencilled.
      let gNumber = unit.gNumber;
      if (gNumber) {
        const clash = await prisma.transformer.findUnique({ where: { gNumber }, select: { id: true } });
        if (clash) {
          result.skipped++;
          result.details.push({ key: unit.key, outcome: "SKIPPED", reason: `G-${gNumber} is already on the register` });
          continue;
        }
      } else {
        gNumber = `G-STAGED-${unit.substationCode}-${unit.key.slice(-4)}`.toUpperCase().slice(0, 40);
        const clash = await prisma.transformer.findUnique({ where: { gNumber }, select: { id: true } });
        if (clash) {
          result.skipped++;
          result.details.push({ key: unit.key, outcome: "SKIPPED", reason: "A staged number for this unit already exists" });
          continue;
        }
      }

      // --- Serial -----------------------------------------------------------
      let serialNumber = unit.serial?.toUpperCase().replace(/\s+/g, "") ?? "";
      if (serialNumber) {
        const clash = await prisma.transformer.findUnique({ where: { serialNumber }, select: { gNumber: true } });
        // A serial already on the register means this physical unit is already
        // known. Promoting would create a duplicate of a real asset.
        if (clash) {
          result.skipped++;
          result.details.push({
            key: unit.key,
            outcome: "SKIPPED",
            reason: `Serial already registered as ${clash.gNumber ?? "another unit"}`,
          });
          continue;
        }
      } else {
        serialNumber = `UNKNOWN-${gNumber}`;
      }

      const manufacturerId = await manufacturerFor(unit.make);
      const occurredAt = unit.lastInspectedOn;

      const notes = [
        `Promoted from the KPLC substation inspection register (Nairobi West).`,
        `Substation ${unit.substationCode}${unit.substationName ? ` — ${unit.substationName}` : ""}.`,
        `${unit.visits} inspection${unit.visits === 1 ? "" : "s"} on file; latest ${occurredAt.toISOString().slice(0, 10)} by ${unit.inspectorRef}.`,
        unit.locationNote ? `Recorded location: ${unit.locationNote}.` : null,
        !unit.gNumber ? "G-Number was not readable on the plate; a staged number was issued." : null,
        !unit.serial ? "Serial number was not readable from the ground." : null,
        "No GPS position: the register records a written landmark, not coordinates. Requires a field survey to place on the map.",
      ]
        .filter(Boolean)
        .join(" ");

      await prisma.$transaction(async (tx) => {
        const created = await tx.transformer.create({
          data: {
            serialNumber,
            gNumber,
            manufacturerId,
            ratingKva: unit.ratingKva!,
            yearOfManufacture: unit.yom!,

            status: "IN_FIELD",
            substationCode: unit.substationCode,
            substationName: unit.substationName,
            currentSiteName: unit.locationNote ?? unit.substationName,
            region: unit.region,
            county: unit.county,

            // No coordinates. The register has none, and a pin we invented
            // would be indistinguishable on the map from one someone surveyed.
            currentLat: null,
            currentLng: null,

            dataSource: "INSPECTION_REGISTER",
            lastInspectionAt: occurredAt,
            structureCondition: (unit.structure as never) ?? undefined,

            // Not verified: promotion is a paperwork act. The amber badge stays
            // until a field engineer physically stands at the asset.
            verifiedAt: null,

            // No warranty claimed — we do not know when KPLC took delivery.
            warrantyMonths: 0,
            warrantyStart: null,
            commissionDate: null,
          },
        });

        const hash = computeEventHash(null, {
          transformerId: created.id,
          type: "ONBOARDED_EXISTING",
          toStatus: "IN_FIELD",
          userId: actor.id,
          occurredAt,
          notes,
        });

        await tx.lifecycleEvent.create({
          data: {
            transformerId: created.id,
            type: "ONBOARDED_EXISTING",
            fromStatus: null,
            toStatus: "IN_FIELD",
            userId: actor.id,
            occurredAt,
            locationName: unit.locationNote ?? unit.substationName,
            notes,
            hash,
            prevHash: null,
          },
        });

        await tx.transformer.update({
          where: { id: created.id },
          data: { lastEventHash: hash },
        });

        // Attach every inspection of this unit to the new transformer, so the
        // promotion is traceable back to the rows it came from.
        await tx.substationInspection.updateMany({
          where: { id: { in: unit.inspectionIds } },
          data: { transformerId: created.id, matchedBy: "MANUAL" },
        });
      });

      result.promoted++;
      result.details.push({ key: unit.key, outcome: "PROMOTED", label: gNumber });
    } catch (e) {
      result.failed++;
      result.details.push({
        key: unit.key,
        outcome: "FAILED",
        reason: e instanceof Error ? e.message.slice(0, 160) : "Unknown error",
      });
    }
  }

  return result;
}
