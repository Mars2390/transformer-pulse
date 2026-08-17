"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGeolocation } from "@/lib/useGeolocation";
import { GpsCapture } from "@/components/field/GpsCapture";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { FormError, inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/**
 * Confirming that a lorry left, and that it turned up.
 *
 * Neither is an approval, on purpose. The only people who can honestly say a
 * vehicle departed and arrived are the two standing next to it; putting a
 * manager in the middle would mean both timestamps get typed in from memory
 * hours later, which is worse than not recording them.
 *
 * Arrival is the moment the chain is written, so it asks for the evidence the
 * lifecycle rule demands — a fix and a photograph when the unit is landing on a
 * pole. The API refuses without them regardless.
 */
export function LegActions({
  transactionId,
  status,
  needsEvidence,
  toName,
  presence,
}: {
  transactionId: string;
  status: string;
  needsEvidence: boolean;
  toName: string;
  /**
   * Site-origin movements only. `null` means this movement does not start at a
   * site and there is nobody to be present.
   */
  presence?: {
    engineerName: string | null;
    confirmedAt: string | null;
    confirmedByName: string | null;
  } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, capture } = useGeolocation(false);

  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(leg: "DEPART" | "ARRIVE") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/transactions/${transactionId}/leg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leg,
          lat: state.status === "ready" ? state.lat : undefined,
          lng: state.status === "ready" ? state.lng : undefined,
          accuracyM: state.status === "ready" ? Math.round(state.accuracyM) : undefined,
          photoUrls,
          notes: notes || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not record that.");
        return;
      }
      toast(data.message, data.alerts?.length ? "error" : "success");
      router.refresh();
    } catch {
      setError("No connection. Nothing was recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "PENDING_APPROVAL") {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        Waiting for approval. Nothing can leave until a manager authorises this movement.
      </p>
    );
  }

  if (status === "REJECTED") {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
        This movement was refused. Raise a new one if the situation has changed.
      </p>
    );
  }

  if (status === "COMPLETED") {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
        Complete. The arrival is on the transformer&apos;s chain.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {status === "APPROVED" && (
        <>
          {/* The gate, stated before the button rather than as an error after
              it. A control somebody discovers by being refused is a control
              they resent; one they can see coming is one they plan around. */}
          {presence && !presence.confirmedAt ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-extrabold text-amber-900">
                Waiting on the engineer at the site
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {presence.engineerName
                  ? `${presence.engineerName} has not confirmed they are at the site yet. It appears on their dashboard, and only they can confirm it — nobody can do it on their behalf.`
                  : "No field engineer is named on this movement, so nothing can leave the site."}
              </p>
            </div>
          ) : (
            <>
              {presence?.confirmedAt && (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900">
                  {presence.confirmedByName ?? "The engineer"} confirmed presence at the site on{" "}
                  {new Date(presence.confirmedAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  .
                </p>
              )}
              <p className="text-sm text-ink-soft">
                Approved and ready to leave. Confirm departure when the vehicle actually pulls out —
                that timestamp is what makes the journey traceable.
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => send("DEPART")}
            disabled={busy || Boolean(presence && !presence.confirmedAt)}
            className="w-full rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:bg-ink-soft/40"
          >
            {busy
              ? "Recording…"
              : presence && !presence.confirmedAt
                ? "Blocked until the engineer confirms"
                : "Confirm departure"}
          </button>
        </>
      )}

      {status === "IN_TRANSIT" && (
        <>
          <p className="text-sm text-ink-soft">
            On the road. Whoever receives it at {toName} confirms arrival — that is the moment this
            movement is written onto the chain.
          </p>

          {needsEvidence && (
            <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
              <p className="text-xs font-bold text-navy">
                This arrival puts the unit on a pole, so it needs a fix and a photograph.
              </p>
              <GpsCapture state={state} onRetry={capture} required />
              <PhotoUpload value={photoUrls} onChange={setPhotoUrls} max={5} label="" hint="At least one." />
            </div>
          )}

          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth noting on arrival"
            className={`${inputClass} text-base`}
          />

          <button
            type="button"
            onClick={() => send("ARRIVE")}
            disabled={busy}
            className="w-full rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:bg-ink-soft/40"
          >
            {busy ? "Recording…" : `Confirm arrival at ${toName}`}
          </button>
        </>
      )}

      {error && <FormError message={error} />}
    </div>
  );
}
