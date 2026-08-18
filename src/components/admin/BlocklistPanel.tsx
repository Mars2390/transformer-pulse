"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/Toast";
import { inputClass } from "@/components/ui/input-class";

type Block = {
  id: string;
  ipAddress: string;
  reason: string;
  source: string;
  expiresAt: string | null;
  hitsSinceBlock: number;
  createdAt: string;
  blockedBy: { name: string } | null;
};

export function BlocklistPanel() {
  const router = useRouter();
  const toast = useToast();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("60");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/security/blocklist");
    if (res.ok) setBlocks((await res.json()).blocks ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/security/blocklist", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? "That did not work.", "error");
        return;
      }
      toast(data.message ?? "Done.", "success");
      setIp("");
      setReason("");
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Blocked addresses" />

      <div className="space-y-2 border-b border-line px-5 py-4">
        <input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="41.90.0.0"
          className={`${inputClass} font-mono text-sm`}
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this address being refused?"
          className={`${inputClass} text-sm`}
        />
        <select value={duration} onChange={(e) => setDuration(e.target.value)} className={`${inputClass} text-sm`}>
          <option value="60">1 hour</option>
          <option value="1440">24 hours</option>
          <option value="10080">7 days</option>
          <option value="permanent">Permanent — review this choice</option>
        </select>
        <button
          type="button"
          disabled={busy || ip.trim().length < 3 || reason.trim().length < 3}
          onClick={() =>
            submit("POST", {
              ipAddress: ip.trim(),
              reason: reason.trim(),
              durationMinutes: duration === "permanent" ? null : Number(duration),
            })
          }
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-red-700 px-4 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-40"
        >
          Block this address
        </button>
        <p className="text-[11px] leading-relaxed text-ink-soft">
          One mobile address can carry an entire county of field engineers. Prefer a time-boxed
          block; make it permanent only when you know the address belongs to one machine.
        </p>
      </div>

      {blocks.length === 0 ? (
        <EmptyState message="Nothing is blocked." />
      ) : (
        <ul className="divide-y divide-line">
          {blocks.map((b) => (
            <li key={b.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-navy">{b.ipAddress}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    b.source === "MANUAL" ? "bg-navy/10 text-navy" : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {b.source === "MANUAL" ? "by hand" : "automatic"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submit("DELETE", { ipAddress: b.ipAddress })}
                  className="ml-auto inline-flex min-h-11 items-center px-2 text-xs font-bold text-kplc hover:underline disabled:opacity-40"
                >
                  Release
                </button>
              </div>
              <p className="mt-1 text-[11px] text-ink-soft">
                {b.reason}
                {" · "}
                {b.expiresAt ? `expires ${new Date(b.expiresAt).toISOString().slice(0, 16).replace("T", " ")}` : "permanent"}
                {b.hitsSinceBlock > 0 ? ` · ${b.hitsSinceBlock} request(s) refused since` : ""}
                {b.blockedBy ? ` · ${b.blockedBy.name}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
