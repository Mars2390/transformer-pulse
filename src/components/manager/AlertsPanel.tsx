"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { formatRelative } from "@/lib/format";

type Alert = {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  createdAtISO: string;
  transformerId: string;
  gNumber: string;
};

const SEVERITY_TONE = { INFO: "info", WARNING: "warning", CRITICAL: "danger" } as const;

/**
 * The manager's live alert list.
 *
 * Fetches on mount and every 20s, so a fault reported in the field surfaces
 * here without a page reload. Acknowledging removes the card immediately
 * (optimistic), then confirms with the server.
 */
export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    const timer = setInterval(() => !document.hidden && load(), 20_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [load]);

  async function acknowledge(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id)); // optimistic
    await fetch(`/api/alerts/${id}`, { method: "PATCH" }).catch(() => load());
  }

  return (
    <div className="rounded-2xl border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-sm font-bold text-navy">
          Alerts{alerts.length > 0 && <span className="ml-1.5 text-ink-soft">({alerts.length})</span>}
        </h2>
        {alerts.length > 0 && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            Live
          </span>
        )}
      </div>

      {!loaded ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-ink-soft">
          Nothing needs your attention. All clear.
        </p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {alerts.map((alert) => (
            <li key={alert.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <Badge tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Badge>
                <span className="shrink-0 text-[11px] text-ink-soft">
                  {formatRelative(alert.createdAtISO)}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-navy">{alert.message}</p>
              <div className="mt-2.5 flex items-center gap-3">
                <Link
                  href={`/transformers/${alert.transformerId}`}
                  className="text-[11px] font-bold text-kplc hover:underline"
                >
                  View transformer →
                </Link>
                <button
                  type="button"
                  onClick={() => acknowledge(alert.id)}
                  className="text-[11px] font-bold text-ink-soft hover:text-navy"
                >
                  Acknowledge
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
