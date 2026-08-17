"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type PendingItem = { label: string; count: number; href: string; urgent: boolean };
type AlertRow = {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAtISO: string;
  transformerId: string;
  gNumber: string;
};

/**
 * The header bell: what happened, and what is waiting on you.
 *
 * It carries two different kinds of thing and they behave differently on
 * purpose.
 *
 * ALERTS are events. A transformer arrived, a unit failed its intake test, a
 * phase went overloaded. Those are facts with a timestamp; they are stored, and
 * they stay until somebody acknowledges them.
 *
 * PENDING APPROVALS are a count of outstanding work, and they are computed on
 * every poll rather than stored — see src/lib/pending-approvals.ts. That is
 * what makes them clear themselves: sign the last approval and the number is
 * gone on the next tick, because there was never a row for anybody to forget to
 * delete. A badge that can be stale is a badge people stop reading, and once
 * they stop reading it they stop seeing the real alerts underneath it too.
 *
 * The panel exists rather than a bare link because "3 approvals pending" is not
 * actionable — three of WHAT, and where? Each line names the kind and goes
 * straight to the queue that holds it.
 */
export function AlertBell() {
  const pathname = usePathname();
  const [badge, setBadge] = useState(0);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      setBadge(data.badgeCount ?? data.unreadCount ?? 0);
      setPending(data.pending?.items ?? []);
      setAlerts(data.alerts ?? []);
    } catch {
      /* a transient failure just means the badge waits for the next tick */
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

  // Re-count after every navigation. Approving something and returning to the
  // dashboard must not leave a stale number sitting there for twenty seconds —
  // that is exactly the "the badge lies" impression this design exists to avoid.
  useEffect(() => {
    load();
    setOpen(false);
  }, [pathname, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const urgent = pending.some((p) => p.urgent);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        aria-label={`${badge} notifications`}
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-navy"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {badge > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white ${
              urgent ? "bg-red-600 ring-2 ring-amber-300" : "bg-red-600"
            }`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          {/* --- Waiting on you ------------------------------------------- */}
          <div className="border-b border-line bg-surface px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
              Waiting on you
            </p>
          </div>
          {pending.length === 0 ? (
            <p className="px-3 py-3 text-xs text-ink-soft">
              Nothing is waiting for your signature.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((p) => (
                <li key={p.href + p.label}>
                  <Link
                    href={p.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface ${
                      p.urgent ? "bg-amber-50" : ""
                    }`}
                  >
                    <span
                      className={`grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-extrabold text-white ${
                        p.urgent ? "bg-amber-600" : "bg-kplc"
                      }`}
                    >
                      {p.count}
                    </span>
                    <span className="min-w-0 flex-1 text-xs font-semibold text-navy">{p.label}</span>
                    <span className="shrink-0 text-ink-soft">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* --- What happened -------------------------------------------- */}
          <div className="border-y border-line bg-surface px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
              Recent activity
            </p>
          </div>
          {alerts.length === 0 ? (
            <p className="px-3 py-3 text-xs text-ink-soft">Nothing new.</p>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto">
              {alerts.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/transformers/${a.transformerId}`}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2.5 hover:bg-surface"
                  >
                    <p className="flex items-center gap-1.5 text-xs font-bold text-navy">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          a.severity === "CRITICAL"
                            ? "bg-red-600"
                            : a.severity === "WARNING"
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                        }`}
                      />
                      {a.gNumber}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-soft">
                      {a.message}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/manager/dashboard#alerts"
            onClick={() => setOpen(false)}
            className="block border-t border-line bg-surface px-3 py-2.5 text-center text-xs font-bold text-kplc hover:bg-surface-2"
          >
            Open the dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
