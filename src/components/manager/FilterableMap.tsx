"use client";

import { useMemo, useState } from "react";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { inputClass } from "@/components/ui/Field";
import { AutoRefresh } from "@/components/app/AutoRefresh";

export type MapRow = MapPoint & {
  manufacturer: string;
  warrantyState: string;
};

/**
 * The full map with live filters. Filtering is client-side: a region's fleet is
 * a few hundred pins at most, so re-querying the server on every dropdown change
 * would add latency for no benefit. The point set is fetched once and sliced in
 * the browser.
 */
export function FilterableMap({
  rows,
  manufacturers,
}: {
  rows: MapRow[];
  manufacturers: string[];
}) {
  const [status, setStatus] = useState("ALL");
  const [rating, setRating] = useState("ALL");
  const [manufacturer, setManufacturer] = useState("ALL");
  const [warranty, setWarranty] = useState("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "ALL" && r.status !== status) return false;
      if (rating !== "ALL" && r.ratingKva !== Number(rating)) return false;
      if (manufacturer !== "ALL" && r.manufacturer !== manufacturer) return false;
      if (warranty !== "ALL" && r.warrantyState !== warranty) return false;
      if (q && !`${r.gNumber ?? ""} ${r.serialNumber} ${r.siteName ?? ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, status, rating, manufacturer, warranty, query]);

  const select = `${inputClass} py-2 text-xs`;

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={30} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search G-Number, site…"
          className={`${select} col-span-2 sm:col-span-3 lg:col-span-1`}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={select}>
          <option value="ALL">All statuses</option>
          <option value="IN_FIELD">In field</option>
          <option value="FAULTY">Faulty</option>
          <option value="IN_STORE">In store</option>
          <option value="IN_TRANSIT">In transit</option>
          <option value="RETURNED">Returned</option>
        </select>
        <select value={rating} onChange={(e) => setRating(e.target.value)} className={select}>
          <option value="ALL">All ratings</option>
          {[50, 100, 200, 315, 500].map((r) => <option key={r} value={r}>{r} kVA</option>)}
        </select>
        <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} className={select}>
          <option value="ALL">All makers</option>
          {manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={warranty} onChange={(e) => setWarranty(e.target.value)} className={select}>
          <option value="ALL">All warranty</option>
          <option value="UNDER_WARRANTY">Under warranty</option>
          <option value="EXPIRING_SOON">Expiring soon</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      <p className="text-xs text-ink-soft">
        Showing {filtered.length} of {rows.length} located transformers.
      </p>

      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="h-[68vh]">
          {/* Re-key so the map recentres on the filtered set. */}
          <TransformerMap key={filtered.length} points={filtered} height="68vh" zoom={9} />
        </div>
      </div>
    </div>
  );
}
