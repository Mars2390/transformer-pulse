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

export type HealthStatusLevel = "HEALTHY" | "BREATHING" | "SURVIVING" | "CRITICAL" | "DECEASED";

export const HEALTH_STATUS_META: Record<
  HealthStatusLevel,
  { emoji: string; label: string; colour: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }
> = {
  HEALTHY: { emoji: "🔵", label: "Healthy", colour: "#1e40af", tone: "info" },
  BREATHING: { emoji: "🟢", label: "Breathing", colour: "#0e8a4f", tone: "success" },
  SURVIVING: { emoji: "🟡", label: "Surviving", colour: "#d97706", tone: "warning" },
  CRITICAL: { emoji: "🔴", label: "Critical", colour: "#dc2626", tone: "danger" },
  DECEASED: { emoji: "⚫", label: "Deceased", colour: "#4b5563", tone: "neutral" },
};

/** Statuses that mean the unit is out of service for good, not just unwell. */
const TERMINAL_STATUSES: TransformerStatus[] = ["BEYOND_REPAIR", "SCRAPPED"];

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

  const known = [electrical, physical].filter((x): x is number => x != null);
  const detail = reasons.slice(0, 2).join("; ") || null;

  if (!known.length) {
    return { level: "BREATHING", explanation: "No electrical or physical data recorded yet — health unverified." };
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
