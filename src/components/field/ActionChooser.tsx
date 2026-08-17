"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui";
import { inputClass } from "@/components/ui/Field";
import type { TransformerStatus, EventType } from "@/generated/prisma/enums";
import { STATUS_META, formatRating } from "@/lib/format";

type Result = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  status: TransformerStatus;
  site: string | null;
  lastEventType: EventType | null;
};

/** The actions legal for a unit in a given state — mirrors the lifecycle rules. */
function actionsFor(r: Result): { href: string; label: string; tone: string }[] {
  const base = `/field/${r.id}`;
  switch (r.status) {
    case "IN_TRANSIT":
      return r.lastEventType === "RECEIVED_BY_FIELD"
        ? [{ href: `${base}/install`, label: "Install", tone: "bg-kplc text-white" }]
        : [{ href: `${base}/receive`, label: "Confirm receipt", tone: "bg-gold text-navy-dark" }];
    case "IN_FIELD":
      return [
        { href: `${base}/inspect`, label: "Inspect", tone: "bg-kplc text-white" },
        { href: `${base}/fault`, label: "Report fault", tone: "bg-red-600 text-white" },
      ];
    case "FAULTY":
      return [
        { href: `${base}/replace`, label: "Replace", tone: "bg-kplc text-white" },
      ];
    default:
      return [];
  }
}

export function ActionChooser() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      fetch(`/api/field/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
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
        placeholder="Search G-Number, serial or site…"
        className={inputClass}
        autoFocus
      />

      {loading && results.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">Searching…</p>
      ) : results.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">
          No transformers in your region match that.
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((r) => {
            const actions = actionsFor(r);
            return (
              <li key={r.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/transformers/${r.id}`} className="inline-flex min-h-11 items-center font-mono text-sm font-bold text-navy hover:text-kplc">
                      {r.gNumber ?? r.serialNumber}
                    </Link>
                    <p className="text-xs text-ink-soft">
                      {formatRating(r.ratingKva)}
                      {r.site ? ` · ${r.site}` : ""}
                    </p>
                  </div>
                  <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
                </div>

                {actions.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {actions.map((a) => (
                      <Link
                        key={a.href}
                        href={a.href}
                        className={`min-h-11 rounded-lg px-4 py-2.5 text-xs font-bold ${a.tone}`}
                      >
                        {a.label}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-soft">
                    No field action available in this state.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
