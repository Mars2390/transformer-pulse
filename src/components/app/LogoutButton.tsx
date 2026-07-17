"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Signs out via POST, then hard-refreshes.
 *
 * `router.refresh()` matters: without it, Next keeps the cached server-rendered
 * pages of the user who just left, and the next person to use the phone can see
 * them until something forces a re-fetch.
 */
export function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={`rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-surface-2 hover:text-navy disabled:opacity-50 ${className}`}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
