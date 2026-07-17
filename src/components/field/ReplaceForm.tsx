"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GpsCapture } from "./GpsCapture";
import { FieldFormHeader, PassFailToggle } from "./controls";
import { FieldTestFields, emptyTest, toTestPayload, type TestValues } from "./FieldTestFields";
import { StickyBar } from "./ConfirmReceiptForm";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { Field, FormError, FormSection, inputClass } from "@/components/ui/Field";
import { useGeolocation } from "@/lib/useGeolocation";
import { useToast } from "@/components/ui/Toast";

type Candidate = { id: string; gNumber: string | null; serialNumber: string; ratingKva: number };

export function ReplaceForm({
  oldId,
  oldLabel,
  oldSite,
  candidates,
}: {
  oldId: string;
  oldLabel: string;
  oldSite: string | null;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, capture } = useGeolocation();

  const [newTransformerId, setNewTransformerId] = useState(candidates[0]?.id ?? "");
  const [oldPhotoUrls, setOldPhotoUrls] = useState<string[]>([]);
  const [newPhotoUrls, setNewPhotoUrls] = useState<string[]>([]);
  const [siteName, setSiteName] = useState(oldSite ?? "");
  const [test, setTest] = useState<TestValues>(emptyTest);
  const [passed, setPassed] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gpsReady = state.status === "ready";
  const canSubmit =
    gpsReady && newTransformerId && newPhotoUrls.length > 0 && siteName.trim().length >= 3 && !busy;

  async function submit() {
    if (!gpsReady) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/transformers/${oldId}/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newTransformerId,
        lat: state.lat, lng: state.lng, accuracyM: state.accuracyM,
        siteName, oldPhotoUrls, newPhotoUrls, notes,
        test: { ...toTestPayload(test), passed, polarityOk: passed },
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not complete the replacement.");
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    toast("Replacement complete. Old unit recovered, new unit live.");
    router.push("/field/dashboard");
    router.refresh();
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-bold text-amber-900">No replacement available</p>
        <p className="mt-1 text-sm text-amber-800">
          There is no transformer in your region ready to install. The store must
          dispatch one, and you must confirm it on site, before you can swap.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
        <p className="text-xs font-bold tracking-wide text-red-700">REMOVING (FAULTY)</p>
        <p className="font-mono text-lg font-bold text-navy">{oldLabel}</p>
        {oldSite && <p className="text-xs text-ink-soft">At {oldSite}</p>}
      </div>

      {error && <FormError message={error} />}

      <FormSection title="Replacement unit">
        <Field label="New transformer" htmlFor="newTransformerId" required>
          <select id="newTransformerId" value={newTransformerId} onChange={(e) => setNewTransformerId(e.target.value)} className={inputClass}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.gNumber ?? c.serialNumber} · {c.ratingKva} kVA
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Old unit — final condition">
        <PhotoUpload value={oldPhotoUrls} onChange={setOldPhotoUrls} max={3} label="" hint="Optional, but recommended for the warranty claim." />
      </FormSection>

      <FormSection title="New unit — installed">
        <PhotoUpload value={newPhotoUrls} onChange={setNewPhotoUrls} max={5} label="" hint="At least one photo is required." />
      </FormSection>

      <FormSection title="Location">
        <GpsCapture state={state} onRetry={capture} required />
      </FormSection>

      <FormSection title="Site">
        <Field label="Site name" htmlFor="siteName" required>
          <input id="siteName" value={siteName} onChange={(e) => setSiteName(e.target.value)} className={inputClass} />
        </Field>
      </FormSection>

      <FormSection title="Commissioning test (new unit)">
        <FieldTestFields values={test} onChange={setTest} variant="install" />
        <div className="mt-5">
          <p className="mb-2 text-xs font-bold text-navy">Overall result</p>
          <PassFailToggle value={passed} onChange={setPassed} />
        </div>
      </FormSection>

      <FormSection title="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Old unit loaded for return to Ruaraka store." />
      </FormSection>

      <StickyBar>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="min-h-14 w-full rounded-xl bg-kplc text-base font-bold text-white shadow-lg shadow-kplc/25 transition-colors hover:bg-kplc-light disabled:opacity-45"
        >
          {busy ? "Completing…" : !gpsReady ? "Waiting for GPS…" : "Complete replacement"}
        </button>
      </StickyBar>
    </div>
  );
}
