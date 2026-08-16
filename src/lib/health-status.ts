import type { TransformerStatus } from "../generated/prisma/enums";

/**
 * The five-level health status shown across the app — story page, map pins,
 * priority list, reports.
 *
 * This sits ON TOP of combined-health.ts's electrical/physical scores rather
 * than replacing them: those two axes stay separate because they call for
 * different crews (see combined-health.ts's own doc-comment). This layer just
 * answers the simpler question a badge needs to answer — "is this transformer
 * okay" — by taking the WORSE of the two axes, the same "min dominates"
 * philosophy the priority ranking already uses.
 *
 * DECEASED overrides everything: a scrapped or beyond-repair unit is not
 * "critical", it is out of service, and showing it in the same red as a live
 * emergency would bury the units that still need a crew sent today.
 */

export type HealthStatusLevel =
  | "HEALTHY"
  | "BREATHING"
  | "SURVIVING"
  | "CRITICAL"
  | "DECEASED"
  | "UNVERIFIED";

export const HEALTH_STATUS_META: Record<
  HealthStatusLevel,
  { emoji: string; label: string; colour: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }
> = {
  HEALTHY: { emoji: "🔵", label: "Healthy", colour: "#1e40af", tone: "info" },
  BREATHING: { emoji: "🟢", label: "Breathing", colour: "#0e8a4f", tone: "success" },
  SURVIVING: { emoji: "🟡", label: "Surviving", colour: "#d97706", tone: "warning" },
  CRITICAL: { emoji: "🔴", label: "Critical", colour: "#dc2626", tone: "danger" },
  DECEASED: { emoji: "⚫", label: "Deceased", colour: "#4b5563", tone: "neutral" },
  // Grey, never green. "We have not measured this" is not good news, and a
  // green badge is read as good news at a glance by everyone who sees it.
  UNVERIFIED: { emoji: "⚪", label: "Unverified", colour: "#7b8383", tone: "neutral" },
};

/** Statuses that mean the unit is out of service for good, not just unwell. */
const TERMINAL_STATUSES: TransformerStatus[] = ["BEYOND_REPAIR", "SCRAPPED"];

/**
 * Statuses that ARE a health verdict on their own, and outrank any score.
 *
 * This is the fix for a transformer showing "Faulty" and "🟢 BREATHING" side by
 * side. The two came from different places: the status from a field engineer who
 * physically reported a failure, the badge from the ABSENCE of a condition
 * score. The old code only let SCRAPPED and BEYOND_REPAIR override, so a faulty
 * unit with no scores fell through to "no data recorded yet" and rendered green.
 *
 * A reported fault is a HARD FACT. A missing score is an absence of evidence.
 * Letting the absence outrank the fact is the same mistake as filling a blank
 * impedance row with 4.5 — presenting "we don't know" as though it were a
 * finding. Facts win.
 */
const STATUS_VERDICTS: Partial<Record<TransformerStatus, { level: HealthStatusLevel; why: string }>> = {
  FAULTY: {
    level: "CRITICAL",
    why: "Reported faulty in service — a crew is needed regardless of what the last test said.",
  },
  AWAITING_REPLACEMENT: {
    level: "CRITICAL",
    why: "Off supply and waiting for a replacement unit.",
  },
  AT_WORKSHOP: {
    level: "SURVIVING",
    why: "At a workshop being repaired — known bad, already in hand.",
  },
  IN_REPAIR: {
    level: "SURVIVING",
    why: "At a workshop being repaired — known bad, already in hand.",
  },
};

/**
 * Statuses where the unit is not energised, so "health" is not the question.
 *
 * A transformer on a shelf is neither well nor unwell. Showing it green implies
 * it has been checked and passed; showing it red implies an emergency. Neither
 * is true, so it gets a grey badge that says what is actually the case.
 */
const NOT_IN_SERVICE: TransformerStatus[] = [
  "PENDING_APPROVAL",
  "REJECTED",
  "IN_STORE",
  "IN_TRANSIT",
  "REPAIRED",
  "RETURNED",
];

export type HealthStatusResult = { level: HealthStatusLevel; explanation: string };

export function deriveHealthStatus({
  electrical,
  physical,
  status,
  reasons = [],
}: {
  electrical: number | null;
  physical: number | null;
  status: TransformerStatus | string;
  reasons?: string[];
}): HealthStatusResult {
  if (TERMINAL_STATUSES.includes(status as TransformerStatus)) {
    return {
      level: "DECEASED",
      explanation: status === "SCRAPPED" ? "Scrapped — removed from the fleet." : "Beyond repair — removed from service.",
    };
  }

  // A reported status outranks a score, and outranks the absence of one.
  const verdict = STATUS_VERDICTS[status as TransformerStatus];
  if (verdict) {
    return { level: verdict.level, explanation: verdict.why };
  }

  const known = [electrical, physical].filter((x): x is number => x != null);
  const detail = reasons.slice(0, 2).join("; ") || null;

  if (NOT_IN_SERVICE.includes(status as TransformerStatus)) {
    return {
      level: "UNVERIFIED",
      explanation: known.length
        ? "Not energised — the scores below are from its last time in service."
        : "Not energised, and never assessed.",
    };
  }

  if (!known.length) {
    return {
      level: "UNVERIFIED",
      explanation: "No electrical or physical data recorded yet — this unit has never been assessed.",
    };
  }

  const worst = Math.min(...known);

  if (worst < 20) {
    return { level: "CRITICAL", explanation: detail ?? "Score below 20 on at least one axis — immediate action required." };
  }
  if (worst < 40) {
    return { level: "SURVIVING", explanation: detail ?? "Significant issues on at least one axis — schedule repair." };
  }
  if (worst < 70) {
    return { level: "BREATHING", explanation: detail ?? "Minor issues on at least one axis — monitor." };
  }
  if (known.length === 2) {
    return { level: "HEALTHY", explanation: "Electrical and physical scores both ≥70, no overloads recorded." };
  }
  // One axis reads healthy but the other has never been measured — cannot
  // confirm both, so this is not yet a clean bill of health.
  return { level: "BREATHING", explanation: "The measured axis is healthy, but the other has not been assessed yet." };
}

/** "CRITICAL: Phase L3 at 121% overload..." — the one-line badge caption used everywhere. */
export function healthStatusCaption(result: HealthStatusResult): string {
  return `${HEALTH_STATUS_META[result.level].label.toUpperCase()}: ${result.explanation}`;
}
