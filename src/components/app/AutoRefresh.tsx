"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a server-rendered page fresh without a manual reload.
 *
 * `router.refresh()` re-runs the server component and swaps in new data while
 * preserving scroll and client state. We refresh when the tab regains focus
 * (the common case — an engineer returns from the camera or another app) and on
 * a gentle interval. No websockets: for a dashboard this size, polling is
 * simpler, cheaper, and good enough.
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const onFocus = () => router.refresh();
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, seconds * 1000);

    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [router, seconds]);

  return null;
}
