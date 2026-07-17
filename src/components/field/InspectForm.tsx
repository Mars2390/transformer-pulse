"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GpsCapture } from "./GpsCapture";
import { ChoiceGroup, FieldFormHeader, PassFailToggle } from "./controls";
import { FieldTestFields, emptyTest, toTestPayload, type TestValues } from "./FieldTestFields";
import { StickyBar } from "./ConfirmReceiptForm";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { FormError, FormSection, inputClass } from "@/components/ui/Field";
import { useGeolocation } from "@/lib/useGeolocation";
import { useToast } from "@/components/ui/Toast";

const CHECKLIST = [
  { name: "tankCondition", label: "Tank condition", options: ["GOOD", "DAMAGED"], bad: ["DAMAGED"] },
  { name: "bushings", label: "Bushings", options: ["GOOD", "DAMAGED"], bad: ["DAMAGED"] },
  { name: "silicaGel", label: "Silica gel", options: ["BLUE", "PINK", "WHITE"], bad: ["PINK"] },
  { name: "oilLevel", label: "Oil level", options: ["NORMAL", "LOW"], bad: ["LOW"] },
  { name: "oilLeaks", label: "Oil leaks", options: ["NONE", "MINOR", "MAJOR"], bad: ["MINOR", "MAJOR"] },
  { name: "earthing", label: "Earthing", options: ["INTACT", "DAMAGED"], bad: ["DAMAGED"] },
  { name: "security", label: "Fence / security", options: ["GOOD", "DAMAGED"], bad: ["DAMAGED"] },
  { name: "vegetation", label: "Vegetation clearance", options: ["ADEQUATE", "OVERGROWN"], bad: ["OVERGROWN"] },
] as const;

export function InspectForm({
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
  const [test, setTest] = useState<TestValues>(emptyTest);
  const [passed, setPassed] = useState(true);
  const [notes, setNotes] = useState("");
  const [visual, setVisual] = useState<Record<string, string>>({
    tankCondition: "GOOD", bushings: "GOOD", silicaGel: "BLUE", oilLevel: "NORMAL",
    oilLeaks: "NONE", earthing: "INTACT", security: "GOOD", vegetation: "ADEQUATE",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const gps = state.status === "ready" ? { lat: state.lat, lng: state.lng, accuracyM: state.accuracyM } : {};

    const response = await fetch(`/api/transformers/${transformerId}/inspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...gps, photoUrls, notes,
        test: { ...toTestPayload(test), passed },
        visual,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not record the inspection.");
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // The GPS-mismatch alert (if any) surfaces to the manager; tell the engineer too.
    toast(data.alerts?.length ? data.alerts[0] : "Inspection recorded.", data.alerts?.length ? "error" : "success");
    router.push("/field/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-5 pb-28">
      <FieldFormHeader gNumber={gNumber} serialNumber={serialNumber} detail={detail} />
      {error && <FormError message={error} />}

      <FormSection title="Photo (optional)">
        <PhotoUpload value={photoUrls} onChange={setPhotoUrls} max={5} label="" hint="Current condition of the unit." />
      </FormSection>

      <FormSection title="Location">
        {state.status !== "ready" && (
          <p className="mb-2 text-xs text-amber-700">
            GPS is not required for an inspection, but it is how we catch a unit that has been moved. Capture it if you can.
          </p>
        )}
        <GpsCapture state={state} onRetry={capture} />
      </FormSection>

      <FormSection title="Test readings">
        <FieldTestFields values={test} onChange={setTest} variant="inspect" />
        <div className="mt-5">
          <p className="mb-2 text-xs font-bold text-navy">Overall result</p>
          <PassFailToggle value={passed} onChange={setPassed} />
        </div>
      </FormSection>

      <FormSection title="Visual checklist">
        <div className="grid gap-5 sm:grid-cols-2">
          {CHECKLIST.map((c) => (
            <ChoiceGroup
              key={c.name}
              label={c.label}
              options={c.options}
              value={visual[c.name]}
              onChange={(v) => setVisual((prev) => ({ ...prev, [c.name]: v }))}
              badValues={c.bad}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} placeholder="Bush cleared, silica gel replaced." />
      </FormSection>

      <StickyBar>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="min-h-14 w-full rounded-xl bg-kplc text-base font-bold text-white shadow-lg shadow-kplc/25 transition-colors hover:bg-kplc-light disabled:opacity-50"
        >
          {busy ? "Recording…" : "Submit inspection"}
        </button>
      </StickyBar>
    </div>
  );
}
