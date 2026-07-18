"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Header bell with a live unread count. Polls the same endpoint as the panel;
 * the red badge is the manager's peripheral-vision signal that something
 * happened while they were looking elsewhere.
 */
export function AlertBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/alerts");
        if (res.ok) setCount((await res.json()).unreadCount ?? 0);
      } catch {
        /* a transient failure just means the badge waits for the next tick */
      }
    };
    load();
    const onFocus = () => load();
    const timer = setInterval(() => !document.hidden && load(), 20_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, []);

  return (
    <Link
      href="/manager/dashboard#alerts"
      className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-navy"
      aria-label={`${count} unread alerts`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5" aria-hidden="true">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
