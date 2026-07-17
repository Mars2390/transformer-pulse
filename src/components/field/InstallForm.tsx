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

export function InstallForm({
  transformerId,
  gNumber,
  serialNumber,
  detail,
  suggestedSite,
}: {
  transformerId: string;
  gNumber: string | null;
  serialNumber: string;
  detail: string;
  suggestedSite: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, capture } = useGeolocation();

  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [test, setTest] = useState<TestValues>(emptyTest);
  const [passed, setPassed] = useState(true);
  const [siteName, setSiteName] = useState(suggestedSite ?? "");
  const [feeder, setFeeder] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gpsReady = state.status === "ready";
  const canSubmit = gpsReady && photoUrls.length > 0 && siteName.trim().length >= 3 && !busy;

  async function submit() {
    if (!gpsReady) return;
    setBusy(true);
    setError(null);

    const response = await fetch(`/api/transformers/${transformerId}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: state.lat, lng: state.lng, accuracyM: state.accuracyM,
        photoUrls, siteName, feeder,
        notes,
        test: { ...toTestPayload(test), passed, polarityOk: passed },
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not record the installation.");
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    toast("Installation recorded. It is now live on the map.");
    router.push("/field/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-5 pb-28">
      <FieldFormHeader gNumber={gNumber} serialNumber={serialNumber} detail={detail} />
      {error && <FormError message={error} />}

      <FormSection title="Photo of the installed unit">
        <PhotoUpload value={photoUrls} onChange={setPhotoUrls} max={5} label="" hint="At least one photo is required." />
      </FormSection>

      <FormSection title="Location">
        <GpsCapture state={state} onRetry={capture} required />
      </FormSection>

      <FormSection title="Site">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site name" htmlFor="siteName" required>
            <input id="siteName" value={siteName} onChange={(e) => setSiteName(e.target.value)} className={inputClass} placeholder="Kabete Primary School" />
          </Field>
          <Field label="Feeder" htmlFor="feeder">
            <input id="feeder" value={feeder} onChange={(e) => setFeeder(e.target.value)} className={inputClass} placeholder="KBT-11kV-04" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Commissioning test">
        <FieldTestFields values={test} onChange={setTest} variant="install" />
        <div className="mt-5">
          <p className="mb-2 text-xs font-bold text-navy">Overall result</p>
          <PassFailToggle value={passed} onChange={setPassed} />
        </div>
      </FormSection>

      <FormSection title="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Mounted and energised. Load balanced." />
      </FormSection>

      <StickyBar>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="min-h-14 w-full rounded-xl bg-kplc text-base font-bold text-white shadow-lg shadow-kplc/25 transition-colors hover:bg-kplc-light disabled:opacity-45"
        >
          {busy
            ? "Recording…"
            : !gpsReady
              ? "Waiting for GPS…"
              : photoUrls.length === 0
                ? "Add a photo to continue"
                : "Submit installation"}
        </button>
      </StickyBar>
    </div>
  );
}
