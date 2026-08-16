"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { inputClass } from "@/components/ui/Field";
import { AutoRefresh } from "@/components/app/AutoRefresh";
import { STATUS_META } from "@/lib/format";
import type { TransformerStatus } from "@/generated/prisma/enums";

export type MapRow = MapPoint & {
  manufacturer?: string;
  warrantyState?: string;
  area?: string | null;
  /**
   * The free text an area is actually matched against — site name, substation
   * name, feeder and region joined together. The `area` bucket above is only
   * the first suburb name found in this text, so filtering on the bucket alone
   * hides a record whose text names two suburbs, or names one the bucket list
   * has never heard of. The filter matches this string instead.
   */
  areaText?: string | null;
};

type PinType = "ALL" | "SURVEYED" | "GEOCODED" | "UNRECORDED";
type HealthBand = "ALL" | "CRITICAL" | "WARNING" | "GOOD" | "NOT_SCORED";

/**
 * Status options, in lifecycle order, built from the same STATUS_META every
 * badge in the system uses. Deriving it here rather than hand-listing six of
 * them is the fix for the filter that quietly hid every repaired, scrapped,
 * beyond-repair and awaiting-replacement unit: a status added to the schema
 * now appears in this dropdown automatically instead of becoming invisible.
 *
 * IN_REPAIR is deliberately absent as its own option. The schema keeps it only
 * so historical rows stay valid, and STATUS_META labels it "At workshop" — two
 * options reading "At workshop" would be a worse lie than one. The AT_WORKSHOP
 * option matches both values instead, see statusMatches().
 */
const STATUS_OPTIONS: TransformerStatus[] = [
  "PENDING_APPROVAL",
  "REJECTED",
  "IN_STORE",
  "IN_TRANSIT",
  "IN_FIELD",
  "FAULTY",
  "AT_WORKSHOP",
  "REPAIRED",
  "BEYOND_REPAIR",
  "AWAITING_REPLACEMENT",
  "RETURNED",
  "SCRAPPED",
];

function statusMatches(selected: string, rowStatus: string) {
  if (selected === "ALL") return true;
  if (selected === "AT_WORKSHOP") return rowStatus === "AT_WORKSHOP" || rowStatus === "IN_REPAIR";
  return rowStatus === selected;
}

/**
 * The full map with live filters. Filtering is client-side: a region's fleet is
 * a few hundred pins at most, so re-querying the server on every dropdown change
 * would add latency for no benefit. The point set is fetched once and sliced in
 * the browser.
 *
 * Filter state lives in the URL as well as in React state, so a manager can
 * paste a link to "faulty, 315 kVA, Westlands" straight into a chat and the
 * recipient sees the same slice without being told how to reproduce it.
 *
 * `unplacedCount` is the number of transformers in scope that have no
 * coordinates at all. They cannot be drawn, so they are never in `rows`; the
 * caption states how many are missing rather than letting a filtered map imply
 * the fleet is fully surveyed.
 */
export function FilterableMap({
  rows,
  manufacturers,
  areas,
  showManufacturerWarranty = true,
  unplacedCount = 0,
}: {
  rows: MapRow[];
  manufacturers?: string[];
  areas?: string[];
  showManufacturerWarranty?: boolean;
  unplacedCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState(searchParams.get("status") ?? "ALL");
  const [rating, setRating] = useState(searchParams.get("rating") ?? "ALL");
  const [manufacturer, setManufacturer] = useState(searchParams.get("make") ?? "ALL");
  const [warranty, setWarranty] = useState(searchParams.get("warranty") ?? "ALL");
  const [area, setArea] = useState(searchParams.get("area") ?? "ALL");
  const [pinType, setPinType] = useState<PinType>((searchParams.get("pin") as PinType) ?? "ALL");
  const [health, setHealth] = useState<HealthBand>((searchParams.get("health") as HealthBand) ?? "ALL");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  const areaList = useMemo(
    () => areas ?? [...new Set(rows.map((r) => r.area).filter((a): a is string => !!a))].sort(),
    [areas, rows],
  );

  /** Push the current filter combination into the URL without a navigation or scroll jump. */
  const syncUrl = useCallback(
    (next: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === "ALL" || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const areaNeedle = area === "ALL" || area === "NONE" ? "" : area.toLowerCase();

    return rows.filter((r) => {
      if (!statusMatches(status, r.status)) return false;
      if (rating !== "ALL" && r.ratingKva !== Number(rating)) return false;
      if (manufacturer !== "ALL" && r.manufacturer !== manufacturer) return false;
      if (warranty !== "ALL" && r.warrantyState !== warranty) return false;

      // Area: case-insensitive substring against the record's own location
      // text, so "Westlands" finds a unit whose site reads "WESTLANDS RD" and a
      // unit bucketed under a second suburb its text also mentions.
      if (area === "NONE") {
        if (r.area) return false;
      } else if (areaNeedle) {
        const haystack = (r.areaText ?? `${r.siteName ?? ""} ${r.substationName ?? ""} ${r.feeder ?? ""} ${r.region ?? ""}`).toLowerCase();
        if (!haystack.includes(areaNeedle)) return false;
      }

      // Position provenance. A row reaching this component always has
      // coordinates, so the old "no location" option could never match one —
      // it silently returned geocoded pins instead. The real invisible group is
      // a pin with coordinates and no recorded provenance, which the store
      // onboarding route leaves null; that is UNRECORDED, and it is now
      // reachable instead of falling through every option.
      if (pinType === "SURVEYED" && r.positionSource !== "SURVEYED") return false;
      if (pinType === "GEOCODED" && r.positionSource !== "GEOCODED") return false;
      if (pinType === "UNRECORDED" && r.positionSource != null && r.positionSource !== "UNAVAILABLE")
        return false;

      if (health === "NOT_SCORED") {
        if (r.healthScore != null) return false;
      } else if (health !== "ALL") {
        // An unscored unit is not healthy and not critical — it is unmeasured.
        // Excluding it from every band is correct, which is exactly why there
        // is now a "Not scored yet" option: selecting a band and getting an
        // empty map used to look like a broken filter rather than an
        // uninspected fleet.
        if (r.healthScore == null) return false;
        if (health === "CRITICAL" && r.healthScore >= 40) return false;
        if (health === "WARNING" && (r.healthScore < 40 || r.healthScore >= 70)) return false;
        if (health === "GOOD" && r.healthScore < 70) return false;
      }

      if (q) {
        const haystack = [
          r.gNumber,
          r.serialNumber,
          r.siteName,
          r.substationName,
          r.feeder,
          r.region,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, status, rating, manufacturer, warranty, area, pinType, health, query]);

  const clearAll = () => {
    setStatus("ALL"); setRating("ALL"); setManufacturer("ALL"); setWarranty("ALL");
    setArea("ALL"); setPinType("ALL"); setHealth("ALL"); setQuery("");
    router.replace(pathname, { scroll: false });
  };

  const anyActive =
    status !== "ALL" || rating !== "ALL" || manufacturer !== "ALL" || warranty !== "ALL" ||
    area !== "ALL" || pinType !== "ALL" || health !== "ALL" || query !== "";

  const select = `${inputClass} py-2 text-xs`;

  // Re-key so the map recentres on the filtered set. Keying on the count alone
  // left the map centred on the previous slice whenever two different filter
  // combinations happened to return the same number of pins; the first and last
  // ids change when the set does.
  const mapKey = `${filtered.length}:${filtered[0]?.id ?? ""}:${filtered[filtered.length - 1]?.id ?? ""}`;

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={30} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); syncUrl({ q: e.target.value }); }}
          placeholder="🔍 Search G-Number, serial, location…"
          className={`${select} col-span-2 sm:col-span-3 lg:col-span-2`}
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); syncUrl({ status: e.target.value }); }}
          className={select}
        >
          <option value="ALL">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>
        <select
          value={rating}
          onChange={(e) => { setRating(e.target.value); syncUrl({ rating: e.target.value }); }}
          className={select}
        >
          <option value="ALL">All ratings</option>
          {[50, 100, 200, 315, 500, 1000].map((r) => <option key={r} value={r}>{r} kVA</option>)}
        </select>

        <select
          value={area}
          onChange={(e) => { setArea(e.target.value); syncUrl({ area: e.target.value }); }}
          className={select}
        >
          <option value="ALL">All areas</option>
          {areaList.map((a) => <option key={a} value={a}>{a}</option>)}
          <option value="NONE">— No area in the record —</option>
        </select>
        <select
          value={pinType}
          onChange={(e) => { setPinType(e.target.value as PinType); syncUrl({ pin: e.target.value }); }}
          className={select}
        >
          <option value="ALL">All pin types</option>
          <option value="SURVEYED">🟢 Surveyed/Verified</option>
          <option value="GEOCODED">🟡 Geocoded/Estimated</option>
          <option value="UNRECORDED">⚫ Provenance not recorded</option>
        </select>
        <select
          value={health}
          onChange={(e) => { setHealth(e.target.value as HealthBand); syncUrl({ health: e.target.value }); }}
          className={select}
        >
          <option value="ALL">All health</option>
          <option value="CRITICAL">🔴 Critical &lt;40</option>
          <option value="WARNING">🟡 Warning 40-69</option>
          <option value="GOOD">🟢 Good ≥70</option>
          <option value="NOT_SCORED">⚪ Not scored yet</option>
        </select>

        {showManufacturerWarranty && manufacturers && (
          <select
            value={manufacturer}
            onChange={(e) => { setManufacturer(e.target.value); syncUrl({ make: e.target.value }); }}
            className={select}
          >
            <option value="ALL">All makers</option>
            {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
        {showManufacturerWarranty && (
          <select
            value={warranty}
            onChange={(e) => { setWarranty(e.target.value); syncUrl({ warranty: e.target.value }); }}
            className={select}
          >
            <option value="ALL">All warranty</option>
            <option value="UNDER_WARRANTY">Under warranty</option>
            <option value="EXPIRING_SOON">Expiring soon</option>
            <option value="EXPIRED">Expired</option>
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-soft">
          Showing <strong className="text-navy">{filtered.length}</strong> of {rows.length} transformers.
          {unplacedCount > 0 && (
            <> {unplacedCount} more {unplacedCount === 1 ? "has" : "have"} no recorded location and cannot be drawn.</>
          )}
        </p>
        {anyActive && (
          <button onClick={clearAll} className="text-xs font-bold text-kplc hover:underline">
            Clear all filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line">
        {filtered.length === 0 ? (
          <div className="flex h-[68vh] flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-bold text-navy">No transformers match your filters.</p>
            <p className="max-w-sm text-xs text-ink-soft">
              Clear filters to see all {rows.length} located transformers
              {unplacedCount > 0 && <> ({unplacedCount} more have no coordinates and never appear on the map)</>}.
            </p>
            <button
              onClick={clearAll}
              className="rounded-xl bg-kplc px-4 py-2 text-xs font-bold text-white transition-transform active:scale-[0.98]"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <div className="h-[68vh]">
            <TransformerMap key={mapKey} points={filtered} height="68vh" zoom={9} />
          </div>
        )}
      </div>
    </div>
  );
}
