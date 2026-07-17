"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GpsCapture } from "./GpsCapture";
import { FieldFormHeader } from "./controls";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { useGeolocation } from "@/lib/useGeolocation";
import { useToast } from "@/components/ui/Toast";

export function ConfirmReceiptForm({
  transformerId,
  gNumber,
  serialNumber,
  detail,
  dispatchInfo,
}: {
  transformerId: string;
  gNumber: string | null;
  serialNumber: string;
  detail: string;
  dispatchInfo: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, capture } = useGeolocation();
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const gps = state.status === "ready" ? { lat: state.lat, lng: state.lng, accuracyM: state.accuracyM } : {};

    const response = await fetch(`/api/transformers/${transformerId}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...gps, photoUrls, notes }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not confirm receipt.");
      setBusy(false);
      return;
    }
    toast("Receipt confirmed. Ready for installation.");
    router.push("/field/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-5 pb-28">
      <FieldFormHeader gNumber={gNumber} serialNumber={serialNumber} detail={detail} />

      {dispatchInfo && (
        <div className="rounded-xl border border-line bg-white p-3 text-sm text-ink-soft">
          {dispatchInfo}
        </div>
      )}

      {error && <FormError message={error} />}

      <div>
        <p className="mb-2 text-xs font-bold text-navy">Location (optional)</p>
        <GpsCapture state={state} onRetry={capture} />
      </div>

      <PhotoUpload value={photoUrls} onChange={setPhotoUrls} max={3} label="Photo (optional)" hint="The unit on the truck, if you can." />

      <Field label="Notes (optional)" htmlFor="notes">
        <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Arrived in good condition." />
      </Field>

      <StickyBar>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="min-h-14 w-full rounded-xl bg-gold text-base font-bold text-navy-dark shadow-lg shadow-gold/20 transition-colors hover:bg-gold-dark disabled:opacity-50"
        >
          {busy ? "Confirming…" : "Confirm receipt"}
        </button>
      </StickyBar>
    </div>
  );
}

export function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-white/95 p-4 backdrop-blur-md md:bottom-0">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}
