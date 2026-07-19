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
  RECEIVED_AT_STORE: {
    // Genesis is written by the receive form, which creates the transformer and
    // its first event together. This transition covers the OTHER case: a unit
    // coming back from the field into the store.
    allowedFrom: ["IN_TRANSIT"],
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
    allowedFrom: ["FAULTY", "IN_STORE", "RETURNED"],
    toStatus: "SCRAPPED",
    label: "Scrapped",
    description: "Written off. The end of the asset's story.",
    requires: {},
  },
};

export const STATUS_LABELS: Record<TransformerStatus, string> = {
  IN_STORE: "in store",
  IN_TRANSIT: "in transit",
  IN_FIELD: "in the field",
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
