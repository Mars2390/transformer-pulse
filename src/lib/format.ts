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
  TESTED: { label: "Tested", tone: "info" },
  DISPATCHED: { label: "Dispatched", tone: "warning" },
  RECEIVED_BY_FIELD: { label: "Received on site", tone: "warning" },
  INSTALLED: { label: "Installed", tone: "success" },
  INSPECTED: { label: "Inspected", tone: "success" },
  FAULT_REPORTED: { label: "Fault reported", tone: "danger" },
  RECOVERED: { label: "Recovered", tone: "warning" },
  RETURNED_TO_MANUFACTURER: { label: "Returned to manufacturer", tone: "neutral" },
  SCRAPPED: { label: "Scrapped", tone: "neutral" },
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Regional Manager",
  STORE_KEEPER: "Store Keeper",
  FIELD_ENGINEER: "Field Engineer",
};
