"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { inputClass } from "@/components/ui/Field";
import { AutoRefresh } from "@/components/app/AutoRefresh";

export type MapRow = MapPoint & {
  manufacturer?: string;
  warrantyState?: string;
  area?: string | null;
};

type PinType = "ALL" | "SURVEYED" | "GEOCODED" | "UNCONFIRMED";
type HealthBand = "ALL" | "CRITICAL" | "WARNING" | "GOOD";

/**
 * The full map with live filters. Filtering is client-side: a region's fleet is
 * a few hundred pins at most, so re-querying the server on every dropdown change
 * would add latency for no benefit. The point set is fetched once and sliced in
 * the browser.
 *
 * Filter state lives in the URL as well as in React state, so a manager can
 * paste a link to "faulty, 315 kVA, Westlands" straight into a chat and the
 * recipient sees the same slice without being told how to reproduce it.
 */
export function FilterableMap({
  rows,
  manufacturers,
  areas,
  showManufacturerWarranty = true,
}: {
  rows: MapRow[];
  manufacturers?: string[];
  areas?: string[];
  showManufacturerWarranty?: boolean;
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

  const areaList = useMemo(() => areas ?? [...new Set(rows.map((r) => r.area).filter((a): a is string => !!a))].sort(), [areas, rows]);

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
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (rating !== "ALL" && r.ratingKva !== Number(rating)) return false;
      if (manufacturer !== "ALL" && r.manufacturer !== manufacturer) return false;
      if (warranty !== "ALL" && r.warrantyState !== warranty) return false;
      if (area !== "ALL" && r.area !== area) return false;
      if (pinType === "SURVEYED" && r.positionSource !== "SURVEYED") return false;
      if (pinType === "GEOCODED" && r.positionSource !== "GEOCODED") return false;
      if (pinType === "UNCONFIRMED" && r.positionSource === "SURVEYED") return false;
      if (health !== "ALL") {
        if (r.healthScore == null) return false;
        if (health === "CRITICAL" && r.healthScore >= 40) return false;
        if (health === "WARNING" && (r.healthScore < 40 || r.healthScore >= 70)) return false;
        if (health === "GOOD" && r.healthScore < 70) return false;
      }
      if (q && !`${r.gNumber ?? ""} ${r.serialNumber} ${r.siteName ?? ""}`.toLowerCase().includes(q))
        return false;
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
          <option value="IN_FIELD">In field</option>
          <option value="FAULTY">Faulty</option>
          <option value="AT_WORKSHOP">At workshop</option>
          <option value="IN_STORE">In store</option>
          <option value="IN_TRANSIT">In transit</option>
          <option value="RETURNED">Returned</option>
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
        </select>
        <select
          value={pinType}
          onChange={(e) => { setPinType(e.target.value as PinType); syncUrl({ pin: e.target.value }); }}
          className={select}
        >
          <option value="ALL">All pin types</option>
          <option value="SURVEYED">🟢 Surveyed/Verified</option>
          <option value="GEOCODED">🟡 Geocoded/Estimated</option>
          <option value="UNCONFIRMED">⚫ No location</option>
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
        </p>
        {anyActive && (
          <button onClick={clearAll} className="text-xs font-bold text-kplc hover:underline">
            Clear all filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="h-[68vh]">
          {/* Re-key so the map recentres on the filtered set. */}
          <TransformerMap key={filtered.length} points={filtered} height="68vh" zoom={9} />
        </div>
      </div>
    </div>
  );
}
