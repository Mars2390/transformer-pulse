import type {
  EventType,
  Role,
  TransformerStatus,
} from "@/generated/prisma/enums";

/** Display formatting, in one file, so the whole app speaks with one voice. */

export function formatKes(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Compact money for stat tiles: "KES 8.4M", not "KES 8,437,000". */
export function formatKesCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `KES ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `KES ${Math.round(value / 1_000)}K`;
  return `KES ${Math.round(value)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-KE").format(value);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-KE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 days ago", "in 2 months" — for timelines and warranty countdowns. */
export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const diffSeconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, seconds] of units) {
    if (abs >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return "just now";
}

/** Stored normalised (KDG456T); read the way people say it (KDG 456T). */
export function formatPlate(plate: string | null | undefined): string {
  if (!plate) return "—";
  const match = plate.match(/^(K[A-Z]{2})(\d{3})([A-Z]?)$/);
  return match ? `${match[1]} ${match[2]}${match[3]}` : plate;
}

export function formatRating(kva: number): string {
  return kva >= 1000 ? `${kva / 1000} MVA` : `${kva} kVA`;
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const STATUS_META: Record<
  TransformerStatus,
  { label: string; tone: Tone }
> = {
  IN_STORE: { label: "In store", tone: "info" },
  IN_TRANSIT: { label: "In transit", tone: "warning" },
  IN_FIELD: { label: "In field", tone: "success" },
  FAULTY: { label: "Faulty", tone: "danger" },
  RETURNED: { label: "Returned", tone: "neutral" },
  SCRAPPED: { label: "Scrapped", tone: "neutral" },
};

export const EVENT_META: Record<EventType, { label: string; tone: Tone }> = {
  RECEIVED_AT_STORE: { label: "Received at store", tone: "info" },
  ONBOARDED_EXISTING: { label: "Onboarded — existing", tone: "warning" },
  TESTED: { label: "Tested", tone: "info" },
  DISPATCHED: { label: "Dispatched", tone: "warning" },
  RECEIVED_BY_FIELD: { label: "Received on site", tone: "warning" },
  INSTALLED: { label: "Installed", tone: "success" },
  INSPECTED: { label: "Inspected", tone: "success" },
  LOAD_CHECK_RECORDED: { label: "Load check", tone: "info" },
  FAULT_REPORTED: { label: "Fault reported", tone: "danger" },
  RECOVERED: { label: "Recovered", tone: "warning" },
  RETURNED_TO_MANUFACTURER: { label: "Returned to manufacturer", tone: "neutral" },
  SCRAPPED: { label: "Scrapped", tone: "neutral" },
};

/**
 * Where a transformer's position came from, and how much it should be trusted.
 *
 * A pin dropped from an office chair and a pin dropped standing underneath the
 * transformer are different claims. The map must never present them as the
 * same one — so every onboarded unit carries its provenance until a field
 * engineer physically confirms it, and the legend says which is which.
 */
export const DATA_SOURCE_META: Record<
  string,
  { label: string; short: string; tone: Tone; accuracy: string }
> = {
  OSM_SURVEYED: {
    label: "OpenStreetMap — surveyed asset",
    short: "OSM surveyed",
    tone: "warning",
    accuracy: "A mapped power asset at this point. Within a few metres.",
  },
  OSM_INFERRED: {
    label: "OpenStreetMap — inferred from site",
    short: "OSM inferred",
    tone: "warning",
    accuracy: "Placed at a real named site. The transformer serves it, but its exact position in the plot is unconfirmed — 20 to 80 m.",
  },
  MANUAL_PIN: {
    label: "Manual map pin",
    short: "Manual pin",
    tone: "warning",
    accuracy: "Positioned by hand on the map. Roughly 5 m if the operator could see the unit.",
  },
};

/** The badge a transformer carries on the map and its story page. */
export function provenanceBadge(
  dataSource: string | null,
  verifiedAt: Date | null,
): { label: string; tone: Tone } {
  if (verifiedAt) return { label: "Verified — physical inspection", tone: "success" };
  if (!dataSource) return { label: "Recorded in service", tone: "info" };
  return {
    label: `Demonstration data — ${DATA_SOURCE_META[dataSource]?.short ?? dataSource}`,
    tone: "warning",
  };
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Regional Manager",
  STORE_KEEPER: "Store Keeper",
  FIELD_ENGINEER: "Field Engineer",
};
