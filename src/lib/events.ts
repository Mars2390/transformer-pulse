import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { EventType, TransformerStatus } from "@/generated/prisma/enums";
import { prisma } from "./prisma";
import { computeEventHash } from "./chain";
import { checkTransition, LIFECYCLE_RULES } from "./lifecycle";
import { computeWarranty, estimateReplacementValueKes } from "./warranty";
import { distanceKm, GPS_MISMATCH_THRESHOLD_KM } from "./geo";
import type { SessionUser } from "./session";
import type { TestValuesInput } from "./validation";

/**
 * Recording a lifecycle event is THE core operation of Transformer DNA.
 * Everything else in the app is a view over what this function writes.
 *
 * It runs as ONE database transaction so that the event, its test results, the
 * transformer's new state, and any alerts all land together or not at all. A
 * half-written movement is worse than no record: it is a record that lies.
 */

export class LifecycleError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

export type RecordEventInput = {
  type: EventType;
  occurredAt?: Date;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  locationName?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  destination?: string | null;
  photoUrls?: string[];
  notes?: string | null;
  test?: TestValuesInput | null;
  clientEventId?: string | null;

  /** Set on install/relocate — where the unit now physically lives. */
  siteName?: string | null;
  feeder?: string | null;
  sdb?: string | null;
  region?: string | null;
  county?: string | null;

  /** Set on return-to-store — which store took it back. */
  storeId?: string | null;

  /** Links this event to its counterpart in a replacement (see replace flow). */
  linkedEventId?: string | null;
};

export type RecordEventResult = {
  eventId: string;
  fromStatus: TransformerStatus | null;
  toStatus: TransformerStatus;
  hash: string;
  alerts: string[];
  duplicate: boolean;
};

export async function recordEvent(
  transformerId: string,
  input: RecordEventInput,
  actor: SessionUser,
): Promise<RecordEventResult> {
  return prisma.$transaction(async (tx) => {
    if (input.clientEventId) {
      const existing = await tx.lifecycleEvent.findUnique({
        where: { clientEventId: input.clientEventId },
      });
      if (existing) {
        return {
          eventId: existing.id,
          fromStatus: existing.fromStatus,
          toStatus: existing.toStatus,
          hash: existing.hash,
          alerts: [],
          duplicate: true,
        };
      }
    }

    const transformer = await tx.transformer.findUnique({
      where: { id: transformerId },
      include: { manufacturer: true },
    });
    if (!transformer) throw new LifecycleError("Transformer not found.", 404);

    const transition = checkTransition(input.type, transformer.status);
    if (!transition.ok) throw new LifecycleError(transition.reason, 409);

    const rule = LIFECYCLE_RULES[input.type];
    const occurredAt = input.occurredAt ?? new Date();

    if (rule.requires.gps && (input.lat == null || input.lng == null)) {
      throw new LifecycleError(
        `"${rule.label}" must include GPS coordinates. Turn on location and try again.`,
      );
    }
    if (rule.requires.vehicle && !input.vehiclePlate) {
      throw new LifecycleError(
        `"${rule.label}" must record the number plate of the vehicle that moved it.`,
      );
    }
    if (rule.requires.test && !input.test) {
      throw new LifecycleError(`"${rule.label}" must include test results.`);
    }
    if (rule.requires.photo && !(input.photoUrls ?? []).length) {
      throw new LifecycleError(`"${rule.label}" must include a photograph.`);
    }

    // checkTransition already refuses these, since DISPATCHED and TESTED allow
    // only IN_STORE. This exists to replace "cannot record Dispatched on a
    // transformer that is booked in and waiting for approval" with a sentence
    // that tells the store keeper what to do about it.
    if (
      (transformer.status === "PENDING_APPROVAL" || transformer.status === "REJECTED") &&
      (input.type === "DISPATCHED" || input.type === "TESTED")
    ) {
      throw new LifecycleError(
        transformer.status === "PENDING_APPROVAL"
          ? "This transformer is still waiting for approval. Someone other than the officer who booked it in has to accept it into stock before it can be tested or dispatched."
          : "This transformer was rejected at intake. It is not stock, and cannot be tested or dispatched.",
        409,
      );
    }

    if (input.type === "DISPATCHED") {
      const intake = await tx.testRecord.findFirst({
        where: { transformerId, stage: "STORE_INTAKE" },
        orderBy: { testedAt: "desc" },
      });
      if (!intake) {
        throw new LifecycleError(
          "This transformer has not had its intake test. Record the test before dispatching it.",
          409,
        );
      }
      if (!intake.passed) {
        throw new LifecycleError(
          "This transformer failed its intake test. It cannot be dispatched to the field.",
          409,
        );
      }
    }

    const prevHash = transformer.lastEventHash;
    const hash = computeEventHash(prevHash, {
      transformerId,
      type: input.type,
      toStatus: transition.toStatus,
      userId: actor.id,
      occurredAt,
      lat: input.lat,
      lng: input.lng,
      vehiclePlate: input.vehiclePlate,
      driverName: input.driverName,
      notes: input.notes,
    });

    const event = await tx.lifecycleEvent.create({
      data: {
        transformerId,
        type: input.type,
        fromStatus: transformer.status,
        toStatus: transition.toStatus,
        userId: actor.id,
        occurredAt,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracyM: input.accuracyM ?? null,
        locationName: input.locationName ?? input.siteName ?? null,
        vehiclePlate: input.vehiclePlate ?? null,
        driverName: input.driverName ?? null,
        driverPhone: input.driverPhone ?? null,
        destination: input.destination ?? null,
        photoUrls: input.photoUrls ?? [],
        notes: input.notes ?? null,
        prevHash,
        hash,
        clientEventId: input.clientEventId ?? null,
        linkedEventId: input.linkedEventId ?? null,
      },
    });

    if (input.test) {
      await tx.testRecord.create({
        data: {
          transformerId,
          eventId: event.id,
          testedById: actor.id,
          testedAt: occurredAt,
          ...input.test,
        },
      });
    }

    const update: Prisma.TransformerUpdateInput = {
      status: transition.toStatus,
      lastEventHash: hash,
    };

    if (input.type === "INSTALLED") {
      update.currentLat = input.lat;
      update.currentLng = input.lng;
      update.currentSiteName = input.siteName ?? input.locationName ?? null;
      update.currentStore = { disconnect: true };
      if (input.feeder) update.feeder = input.feeder;
      if (input.sdb) update.sdb = input.sdb;
      if (input.region) update.region = input.region;
      if (input.county) update.county = input.county;
      if (!transformer.commissionDate) update.commissionDate = occurredAt;
    }

    if (input.type === "DISPATCHED") {
      // It has left the store floor but is not yet anywhere.
      update.currentStore = { disconnect: true };
    }

    if (input.type === "INSPECTED") {
      // The moment an onboarded record stops being a claim about the world and
      // becomes a confirmation of it: someone stood under this transformer and
      // saw it. This is what turns the map pin from amber to green, and it can
      // only ever happen once — the first inspection is the baseline.
      if (!transformer.verifiedAt) update.verifiedAt = occurredAt;

      // An inspection also CORRECTS the pin of an onboarded unit — but only a
      // small correction, and only while the unit is still unverified. That is
      // the real case: an OSM pin sat 60 m off and the engineer is standing at
      // the asset.
      //
      // A large discrepancy is deliberately NOT applied. Beyond the mismatch
      // threshold this is no longer a survey correction, it is a transformer
      // that is not where it should be — theft, or a move nobody recorded. That
      // raises a CRITICAL alert below and the recorded position is left alone
      // for a human to rule on. Quietly moving the pin would erase the very
      // discrepancy the alert exists to report.
      if (
        input.lat != null && input.lng != null &&
        !transformer.verifiedAt && transformer.dataSource != null &&
        (transformer.currentLat == null || transformer.currentLng == null ||
          distanceKm(
            { lat: transformer.currentLat, lng: transformer.currentLng },
            { lat: input.lat, lng: input.lng },
          ) <= GPS_MISMATCH_THRESHOLD_KM)
      ) {
        update.currentLat = input.lat;
        update.currentLng = input.lng;
      }
    }

    if (input.type === "RECEIVED_AT_STORE" && input.storeId) {
      update.currentStore = { connect: { id: input.storeId } };
      update.currentLat = null;
      update.currentLng = null;
      update.currentSiteName = null;
    }

    // Once it leaves site, the map pin would be a lie.
    if (input.type === "RECOVERED" || input.type === "RETURNED_TO_MANUFACTURER") {
      update.currentLat = null;
      update.currentLng = null;
      update.currentSiteName = null;
    }

    const alerts: string[] = [];

    // An install is good news, and the manager should see it land on the map.
    if (input.type === "INSTALLED") {
      await tx.alert.create({
        data: {
          transformerId,
          type: "INSTALLED",
          severity: "INFO",
          region: input.region ?? transformer.region,
          message: `${transformer.gNumber ?? transformer.serialNumber} (${transformer.ratingKva} kVA) installed at ${input.siteName ?? input.locationName ?? "site"}.`,
        },
      });
    }

    // Theft / data-error detection: inspected far from where we think it lives.
    if (
      input.type === "INSPECTED" &&
      input.lat != null &&
      input.lng != null &&
      transformer.currentLat != null &&
      transformer.currentLng != null
    ) {
      const drift = distanceKm(
        { lat: transformer.currentLat, lng: transformer.currentLng },
        { lat: input.lat, lng: input.lng },
      );
      if (drift > GPS_MISMATCH_THRESHOLD_KM) {
        const message = `${transformer.gNumber ?? transformer.serialNumber} was inspected ${drift.toFixed(1)} km from its recorded site (${transformer.currentSiteName ?? "unknown"}). Possible unrecorded move, or theft.`;
        alerts.push(message);
        await tx.alert.create({
          data: {
            transformerId,
            type: "GPS_MISMATCH",
            severity: "CRITICAL",
            region: transformer.region,
            message,
          },
        });
      }
    }

    if (input.type === "TESTED" && input.test && !input.test.passed) {
      const message = `${transformer.gNumber ?? transformer.serialNumber} (${transformer.ratingKva} kVA, ${transformer.manufacturer.name}) failed its test. It cannot be dispatched.`;
      alerts.push(message);
      await tx.alert.create({
        data: {
          transformerId,
          type: "INTAKE_TEST_FAILED",
          severity: "WARNING",
          region: transformer.region,
          message,
        },
      });
    }

    if (input.type === "FAULT_REPORTED") {
      const warranty = computeWarranty(
        transformer.warrantyStart,
        transformer.warrantyMonths,
        occurredAt, // as at the FAULT date, not today
      );

      const message = `${transformer.gNumber ?? transformer.serialNumber} (${transformer.ratingKva} kVA) failed at ${input.locationName ?? "site"}${warranty.claimable ? ` with ${warranty.daysRemaining} days of warranty remaining` : ""}.`;
      alerts.push(message);
      await tx.alert.create({
        data: {
          transformerId,
          type: "FAULT_REPORTED",
          severity: "CRITICAL",
          region: transformer.region,
          message,
        },
      });

      // Raise the claim automatically. A manager should never have to remember
      // to check — that is exactly what the paper process relies on, and why
      // money is left with manufacturers.
      if (warranty.claimable) {
        const open = await tx.warrantyClaim.findFirst({
          where: { transformerId, status: { in: ["OPEN", "SUBMITTED"] } },
        });
        if (!open) {
          await tx.warrantyClaim.create({
            data: {
              transformerId,
              manufacturerId: transformer.manufacturerId,
              raisedById: actor.id,
              status: "OPEN",
              faultReason: input.notes ?? "Fault reported in service.",
              claimValueKes: estimateReplacementValueKes(transformer.ratingKva),
            },
          });
        }
      }

      const failures = await tx.lifecycleEvent.count({
        where: { transformerId, type: "FAULT_REPORTED" },
      });
      if (failures >= 2) {
        await tx.alert.create({
          data: {
            transformerId,
            type: "REPEAT_FAILURE",
            severity: "WARNING",
            region: transformer.region,
            message: `${transformer.gNumber ?? transformer.serialNumber} has now failed ${failures} times. Consider returning it to ${transformer.manufacturer.name} rather than repairing again.`,
          },
        });
      }
    }

    await tx.transformer.update({ where: { id: transformerId }, data: update });

    return {
      eventId: event.id,
      fromStatus: transformer.status,
      toStatus: transition.toStatus,
      hash,
      alerts,
      duplicate: false,
    };
  });
}
