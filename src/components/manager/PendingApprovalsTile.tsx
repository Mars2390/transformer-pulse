"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type PendingItem = { label: string; count: number; href: string; urgent: boolean };

/**
 * "Pending approvals" on the manager's dashboard, kept live.
 *
 * A client component rather than a server-rendered number, for one reason: the
 * dashboard is a page somebody leaves open. A count rendered when the tab was
 * opened at eight in the morning is a lie by ten, and the person reading it has
 * no way to tell. This polls the same endpoint as the bell, so the two can
 * never disagree with each other either.
 *
 * The initial value is rendered on the server and passed in, so the tile shows
 * a real number on first paint instead of flashing zero and then correcting
 * itself — which reads as "nothing to do" for exactly long enough to be
 * believed.
 */
export function PendingApprovalsTile({
  initialTotal,
  initialItems,
}: {
  initialTotal: number;
  initialItems: PendingItem[];
}) {
  const pathname = usePathname();
  const [total, setTotal] = useState(initialTotal);
  const [items, setItems] = useState<PendingItem[]>(initialItems);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) return;
      const data = await res.json();
      setTotal(data.pending?.total ?? 0);
      setItems(data.pending?.items ?? []);
    } catch {
      /* keep the last known figure rather than blanking it on a dropped poll */
    }
  }, []);

  useEffect(() => {
    const onFocus = () => load();
    const timer = setInterval(() => !document.hidden && load(), 20_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [load]);

  // Come back from approving something and the tile is right immediately.
  useEffect(() => {
    load();
  }, [pathname, load]);

  const urgent = items.some((i) => i.urgent);

  return (
    <div
      className={`rounded-2xl border p-4 ${
        total === 0
          ? "border-line bg-white"
          : urgent
            ? "border-amber-300 bg-amber-50"
            : "border-line bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold tracking-[0.1em] text-ink-soft">PENDING APPROVALS</p>
        {total > 0 && (
          <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-red-600 px-1.5 text-[11px] font-extrabold text-white">
            {total}
          </span>
        )}
      </div>

      {total === 0 ? (
        <>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-emerald-600">Clear</p>
          <p className="mt-1 text-xs text-ink-soft">Nothing is waiting for your signature.</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-navy">{total}</p>
          <ul className="mt-2 space-y-1">
            {items.map((i) => (
              <li key={i.href + i.label}>
                <Link
                  href={i.href}
                  className={`flex items-center gap-2 text-xs font-semibold hover:underline ${
                    i.urgent ? "text-amber-800" : "text-kplc"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
