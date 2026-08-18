import type { EventType, TransformerStatus } from "@/generated/prisma/enums";

/**
 * The lifecycle state machine.
 *
 * This is why the system beats paper. Paper cannot refuse. A database can.
 *
 * It stops a transformer being "installed" while it is still sitting in a
 * store, or dispatched twice by two different stores, or reported faulty when
 * it was never energised. All of those happen today and are discovered months
 * later, when somebody goes looking for an asset that is not where the file
 * says it is.
 *
 * Every rule below is enforced server-side in recordEvent(). The UI uses the
 * same table to decide which buttons to show — but the UI is a convenience,
 * not the guard.
 */

export type EventRule = {
  /** Statuses the transformer may be in for this event to be legal. */
  allowedFrom: TransformerStatus[];
  /** The status it lands in afterwards. */
  toStatus: TransformerStatus;
  label: string;
  description: string;
  /** Evidence this event cannot be recorded without. */
  requires: {
    gps?: boolean;
    vehicle?: boolean;
    test?: boolean;
    photo?: boolean;
  };
};

export const LIFECYCLE_RULES: Record<EventType, EventRule> = {
  // The only two events that move a unit out of PENDING_APPROVAL, and the only
  // route into stock for a newly delivered unit. A maker cannot fire either:
  // the approvals API refuses when the actor is the person who booked it in.
  APPROVED_FOR_STOCK: {
    allowedFrom: ["PENDING_APPROVAL"],
    toStatus: "IN_STORE",
    label: "Approved into stock",
    description: "A checker accepted the delivery. The unit is stock, and can now be tested and dispatched.",
    requires: {},
  },
  REJECTED_ON_INTAKE: {
    allowedFrom: ["PENDING_APPROVAL"],
    toStatus: "REJECTED",
    label: "Rejected at intake",
    description: "A checker refused the delivery. The record and its chain are kept; the unit never becomes stock.",
    requires: {},
  },
  // See src/lib/transactions.ts for why there are only four of these and not
  // one per movement: the other seven already had events.
  TRANSFERRED_TO_STORE: {
    allowedFrom: ["IN_TRANSIT"],
    toStatus: "IN_STORE",
    label: "Transferred to store",
    description: "Arrived at another store after an inter-store transfer.",
    requires: { vehicle: true },
  },
  SENT_TO_WORKSHOP: {
    allowedFrom: ["IN_STORE", "IN_TRANSIT"],
    toStatus: "AT_WORKSHOP",
    label: "Sent to workshop",
    description: "Sent from a store for testing or refurbishment, without having failed in service.",
    requires: { vehicle: true },
  },
  DEPLOYED_FROM_WORKSHOP: {
    allowedFrom: ["REPAIRED", "AT_WORKSHOP", "IN_TRANSIT"],
    toStatus: "IN_FIELD",
    label: "Deployed from workshop",
    description: "Installed straight from the workshop, without passing back through a store.",
    requires: { gps: true, photo: true },
  },
  CONDEMNED_ON_SITE: {
    allowedFrom: ["FAULTY", "IN_FIELD"],
    toStatus: "SCRAPPED",
    label: "Condemned on site",
    description: "Written off where it stood. Nothing was recovered.",
    requires: { gps: true, photo: true },
  },
  RECEIVED_AT_STORE: {
    // Genesis is written by the receive form, which creates the transformer and
    // its first event together. This transition covers the OTHER cases: a unit
    // coming back from the field, and a repaired unit returning from a
    // workshop ready to be dispatched again.
    allowedFrom: ["IN_TRANSIT", "REPAIRED"],
    toStatus: "IN_STORE",
    label: "Received at store",
    description: "Arrived at a KPLC store.",
    requires: { vehicle: true },
  },
  ONBOARDED_EXISTING: {
    // Empty on purpose. This event is written ONLY by the onboarding route,
    // which creates the transformer and this event together. There is no legal
    // transition INTO it from any existing status, so recordEvent() will refuse
    // it on a transformer that already exists — you cannot re-onboard a unit to
    // paper over its history.
    allowedFrom: [],
    toStatus: "IN_FIELD",
    label: "Onboarded — existing unit",
    description: "An already-installed transformer added to the register.",
    // GPS is the whole point: an onboarded unit has no dispatch or install
    // record, so its position is the only hard fact we have about it.
    requires: { gps: true },
  },
  LOAD_CHECK_RECORDED: {
    // A load check observes the transformer; it does not move it. Legal only
    // on a unit that is actually energised, and it leaves the status alone.
    allowedFrom: ["IN_FIELD"],
    toStatus: "IN_FIELD",
    label: "Load check recorded",
    description: "Meter data ingested and analysed against the nameplate.",
    requires: {},
  },
  TESTED: {
    allowedFrom: ["IN_STORE"],
    toStatus: "IN_STORE",
    label: "Tested",
    description: "Electrical tests performed and recorded.",
    requires: { test: true },
  },
  DISPATCHED: {
    allowedFrom: ["IN_STORE"],
    toStatus: "IN_TRANSIT",
    label: "Dispatched",
    description: "Loaded onto a vehicle and released to the field.",
    requires: { vehicle: true },
  },
  RECEIVED_BY_FIELD: {
    allowedFrom: ["IN_TRANSIT"],
    toStatus: "IN_TRANSIT",
    label: "Received on site",
    description: "Field engineer confirmed it arrived.",
    // GPS is captured when available but not required — a receipt should never
    // be blocked because a phone could not get a fix at the roadside.
    requires: {},
  },
  INSTALLED: {
    allowedFrom: ["IN_TRANSIT", "IN_STORE"],
    toStatus: "IN_FIELD",
    label: "Installed",
    description: "Energised at site. This is where the GPS pin is born.",
    requires: { gps: true, photo: true, test: true },
  },
  INSPECTED: {
    allowedFrom: ["IN_FIELD"],
    toStatus: "IN_FIELD",
    label: "Inspected",
    description: "Routine field inspection.",
    // GPS is strongly wanted (it is how we detect a moved or stolen unit) but
    // not required — an inspection in a signal shadow must still be recordable.
    requires: {},
  },
  // A failed transformer does not simply stop. It comes off the pole, goes to a
  // workshop, is opened, and is either repaired or condemned. Each step is a
  // legal transition and the state machine refuses the rest — you cannot repair
  // a unit that is still energised, and you cannot dispose of one nobody has
  // opened.

  RECOVERED_FOR_REPAIR: {
    // From FAULTY normally; from IN_FIELD when a unit is pulled proactively,
    // which happens after a bad inspection rather than a failure.
    allowedFrom: ["FAULTY", "IN_FIELD"],
    toStatus: "AT_WORKSHOP",
    label: "Recovered for repair",
    description: "Taken off the pole with a workshop as its destination.",
    // Whoever carried it is who we ask when it does not arrive.
    requires: { vehicle: true },
  },
  RECEIVED_AT_WORKSHOP: {
    allowedFrom: ["AT_WORKSHOP", "IN_TRANSIT"],
    toStatus: "AT_WORKSHOP",
    label: "Received at workshop",
    description: "Booked in at the repair workshop.",
    requires: {},
  },
  REPAIR_STARTED: {
    allowedFrom: ["AT_WORKSHOP"],
    toStatus: "AT_WORKSHOP",
    label: "Repair started",
    description: "Work began. The clock on turnaround starts here.",
    requires: {},
  },
  REPAIRED: {
    allowedFrom: ["AT_WORKSHOP"],
    toStatus: "REPAIRED",
    label: "Repaired",
    description: "Work complete and proved by test.",
    // A repair claimed without a test is a repair nobody can stand behind. The
    // unit is about to go back on a pole above someone's house.
    requires: { test: true },
  },
  REPAIR_FAILED: {
    allowedFrom: ["AT_WORKSHOP"],
    toStatus: "BEYOND_REPAIR",
    label: "Repair failed",
    description: "Opened, diagnosed, and not economically repairable.",
    requires: {},
  },
  DISPOSED: {
    // Only from BEYOND_REPAIR: a transformer is condemned by a workshop that
    // opened it, never written off straight from the field.
    allowedFrom: ["BEYOND_REPAIR"],
    toStatus: "SCRAPPED",
    label: "Disposed",
    description: "Scrapped after a failed repair.",
    requires: {},
  },
  AWAITING_REPLACEMENT: {
    allowedFrom: ["FAULTY", "BEYOND_REPAIR"],
    toStatus: "AWAITING_REPLACEMENT",
    label: "Awaiting replacement",
    description: "A site is off supply and no unit of this rating is free.",
    requires: {},
  },

  FAULT_REPORTED: {
    allowedFrom: ["IN_FIELD"],
    toStatus: "FAULTY",
    label: "Fault reported",
    description: "Failed in service. Warranty is checked automatically.",
    requires: { gps: true, photo: true },
  },
  RECOVERED: {
    allowedFrom: ["FAULTY", "IN_FIELD"],
    toStatus: "IN_TRANSIT",
    label: "Recovered",
    description: "Removed from site and loaded for return.",
    requires: { gps: true, vehicle: true },
  },
  RETURNED_TO_MANUFACTURER: {
    allowedFrom: ["FAULTY", "IN_TRANSIT", "IN_STORE"],
    toStatus: "RETURNED",
    label: "Returned to manufacturer",
    description: "Shipped back under a warranty claim.",
    requires: { vehicle: true },
  },
  SCRAPPED: {
    allowedFrom: ["FAULTY", "IN_STORE", "RETURNED", "IN_FIELD"],
    toStatus: "SCRAPPED",
    label: "Scrapped",
    description: "Written off. The end of the asset's story.",
    requires: {},
  },
};

export const STATUS_LABELS: Record<TransformerStatus, string> = {
  PENDING_APPROVAL: "booked in and waiting for approval",
  REJECTED: "rejected at intake",
  IN_STORE: "in store",
  IN_TRANSIT: "in transit",
  IN_FIELD: "in the field",
  AT_WORKSHOP: "at a workshop",
  IN_REPAIR: "at a workshop", // deprecated, kept for any historical row — see enum comment
  REPAIRED: "repaired and awaiting return to store",
  BEYOND_REPAIR: "condemned as beyond repair",
  AWAITING_REPLACEMENT: "awaiting a replacement",
  FAULTY: "faulty",
  RETURNED: "returned",
  SCRAPPED: "scrapped",
};

export type TransitionCheck =
  | { ok: true; toStatus: TransformerStatus }
  | { ok: false; reason: string };

export function checkTransition(
  type: EventType,
  currentStatus: TransformerStatus,
): TransitionCheck {
  const rule = LIFECYCLE_RULES[type];

  if (!rule.allowedFrom.includes(currentStatus)) {
    const allowed = rule.allowedFrom.map((s) => STATUS_LABELS[s]).join(", ");
    return {
      ok: false,
      reason: `Cannot record "${rule.label}" on a transformer that is ${STATUS_LABELS[currentStatus]}. That is only possible when it is: ${allowed}.`,
    };
  }

  return { ok: true, toStatus: rule.toStatus };
}

/** Which events are legal right now. Drives which buttons the UI offers. */
export function allowedEventsFor(status: TransformerStatus): EventType[] {
  return (Object.keys(LIFECYCLE_RULES) as EventType[]).filter(
    (type) => checkTransition(type, status).ok,
  );
}
