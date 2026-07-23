"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Delete a saved mapping profile. Nothing else can be edited — a profile is
 *  re-created by re-confirming a mapping, so there is nothing to update here. */
export function ProfileRowActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/load-formats/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else setConfirming(false);
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs font-bold text-red-700 hover:underline"
      >
        Delete profile
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-ink-soft">Delete “{name}”?</span>
      <button onClick={remove} disabled={busy} className="font-bold text-red-700 hover:underline disabled:opacity-50">
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button onClick={() => setConfirming(false)} className="text-ink-soft hover:underline">Cancel</button>
    </span>
  );
}
