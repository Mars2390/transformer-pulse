"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui";
import { inputClass } from "@/components/ui/Field";
import type { TransformerStatus, EventType } from "@/generated/prisma/enums";
import { EVENT_META, STATUS_META, formatRating, formatRelative } from "@/lib/format";

type Result = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  status: TransformerStatus;
  site: string | null;
  manufacturer: string;
  lastEventType: EventType | null;
  lastEventISO: string | null;
};

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search G-Number, serial, site or manufacturer…"
        className={inputClass}
        autoFocus
      />

      {loading && results.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">Searching…</p>
      ) : results.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-soft">No transformers match.</p>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/transformers/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 transition-colors hover:border-kplc/40"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm font-bold text-navy">
                    {r.gNumber ?? r.serialNumber}
                  </span>
                  <p className="truncate text-xs text-ink-soft">
                    {formatRating(r.ratingKva)} · {r.manufacturer}
                    {r.site ? ` · ${r.site}` : ""}
                    {r.lastEventType ? ` · ${EVENT_META[r.lastEventType].label} ${formatRelative(r.lastEventISO)}` : ""}
                  </p>
                </div>
                <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
