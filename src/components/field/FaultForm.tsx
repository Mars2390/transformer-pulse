"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GpsCapture } from "./GpsCapture";
import { FieldFormHeader } from "./controls";
import { FieldTestFields, emptyTest, toTestPayload, type TestValues } from "./FieldTestFields";
import { StickyBar } from "./ConfirmReceiptForm";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { Field, FormError, FormSection, inputClass } from "@/components/ui/Field";
import { useGeolocation } from "@/lib/useGeolocation";
import { useToast } from "@/components/ui/Toast";
import { FAULT_CAUSES } from "@/lib/field-validation";

export function FaultForm({
  transformerId,
  gNumber,
  serialNumber,
  detail,
}: {
  transformerId: string;
  gNumber: string | null;
  serialNumber: string;
  detail: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, capture } = useGeolocation();

  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [cause, setCause] = useState<string>(FAULT_CAUSES[0]);
  const [description, setDescription] = useState("");
  const [includeTest, setIncludeTest] = useState(false);
  const [test, setTest] = useState<TestValues>(emptyTest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gpsReady = state.status === "ready";
  const canSubmit = gpsReady && photoUrls.length > 0 && description.trim().length >= 5 && !busy;

  async function submit() {
    if (!gpsReady) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/transformers/${transformerId}/fault`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: state.lat, lng: state.lng, accuracyM: state.accuracyM,
        photoUrls, cause, description,
        test: includeTest ? { ...toTestPayload(test), passed: false } : null,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not report the fault.");
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    toast("Fault reported. The manager has been alerted.");
    router.push("/field/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-5 pb-28">
      <FieldFormHeader gNumber={gNumber} serialNumber={serialNumber} detail={detail} />
      {error && <FormError message={error} />}

      <FormSection title="Photo of the damage">
        <PhotoUpload value={photoUrls} onChange={setPhotoUrls} max={5} label="" hint="At least one photo is required." />
      </FormSection>

      <FormSection title="Location">
        <GpsCapture state={state} onRetry={capture} required />
      </FormSection>

      <FormSection title="What happened">
        <Field label="Cause" htmlFor="cause" required>
          <select id="cause" value={cause} onChange={(e) => setCause(e.target.value)} className={inputClass}>
            {FAULT_CAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <div className="mt-4">
          <Field label="Description" htmlFor="description" required>
            <textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="LV bushing flashover after last night's storm. Oil leaking from the tank base." />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Measurements (if still readable)">
        <label className="flex items-center gap-2 text-sm text-navy">
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} className="h-4 w-4" />
          Record what can still be measured
        </label>
        {includeTest && (
          <div className="mt-4">
            <FieldTestFields values={test} onChange={setTest} variant="fault" />
          </div>
        )}
      </FormSection>

      <StickyBar>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="min-h-14 w-full rounded-xl bg-red-600 text-base font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 disabled:opacity-45"
        >
          {busy
            ? "Reporting…"
            : !gpsReady
              ? "Waiting for GPS…"
              : photoUrls.length === 0
                ? "Add a photo to continue"
                : "Report fault"}
        </button>
      </StickyBar>
    </div>
  );
}
