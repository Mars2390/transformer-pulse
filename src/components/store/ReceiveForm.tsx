"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, FormError, FormSection, inputClass } from "@/components/ui/Field";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { DocumentUpload } from "@/components/ui/DocumentUpload";
import { NameplateFields } from "@/components/store/NameplateFields";
import { NameplateOCR, type ConfirmedNameplateData } from "@/components/store/NameplateOCR";

type Manufacturer = {
  id: string;
  name: string;
  warrantyMonths: number;
};

/** Common distribution ratings in KPLC's network. */
const RATINGS = [25, 50, 100, 200, 315, 500, 1000];
const COOLING = ["ONAN", "ONAF", "AN", "AF"];

export function ReceiveForm({
  manufacturers,
  storeName,
}: {
  manufacturers: Manufacturer[];
  storeName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [manufacturerId, setManufacturerId] = useState(manufacturers[0]?.id ?? "");
  const [gNumber, setGNumber] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [fatReportUrl, setFatReportUrl] = useState<string | null>(null);

  // --- Nameplate scan: shown first, hands its result to the form below ----
  // Manual entry is the primary path and the default. The scanner is an
  // optional accelerant: on a rusty plate photographed at an angle it saves
  // nothing, and a keeper who has to dismiss it before every receipt will
  // stop using the system rather than stop using the camera.
  const [showScan, setShowScan] = useState(false);
  const [ocrPrefill, setOcrPrefill] = useState<ConfirmedNameplateData | null>(null);
  // Bumped on every OCR confirm so the uncontrolled inputs below remount
  // with fresh defaultValue props — the same trick a key change always is,
  // used here because these fields are uncontrolled (FormData on submit),
  // not because remounting is otherwise the natural way to update them.
  const [formKey, setFormKey] = useState(0);

  function handleOcrConfirm(data: ConfirmedNameplateData) {
    setOcrPrefill(data);
    if (data.manufacturerId) setManufacturerId(data.manufacturerId);
    setPhotoUrls((prev) => (prev.includes(data.photoUrl) ? prev : [...prev, data.photoUrl]));
    setFormKey((k) => k + 1);
    setShowScan(false);
  }

  const chosen = manufacturers.find((m) => m.id === manufacturerId);

  // Offer the next free G-Number, so the keeper types six digits fewer and the
  // sequence has no accidental holes.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/transformers/suggest-gnumber")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.suggestion) setGNumber(data.suggestion);
      })
      .catch(() => {
        /* Suggestion is a convenience. Typing it by hand still works. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    const form = new FormData(event.currentTarget);
    const payload = { ...Object.fromEntries(form.entries()), photoUrls, fatReportUrl: fatReportUrl ?? "" };

    const response = await fetch("/api/transformers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not register this transformer.");
      setFields(data.fields ?? {});
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    router.push(`/store/test/${data.transformer.id}?received=1`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {showScan && (
        <NameplateOCR
          manufacturers={manufacturers}
          onConfirm={handleOcrConfirm}
          onFillManually={() => setShowScan(false)}
        />
      )}

      {!showScan && ocrPrefill && (
        <div className="flex items-center justify-between rounded-xl border border-kplc/20 bg-kplc/5 px-4 py-3 text-xs">
          <p className="font-semibold text-navy">Form filled from the nameplate scan — check every field below.</p>
          <button type="button" onClick={() => { setShowScan(true); setOcrPrefill(null); }} className="shrink-0 font-bold text-kplc hover:underline">
            Scan again
          </button>
        </div>
      )}

    {!showScan && (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <FormError message={error} />}

      <FormSection
        title="Identity"
        description="The serial number comes from the manufacturer's nameplate and never changes."
      >
        <div key={formKey} className="grid gap-4 sm:grid-cols-2">
          <Field label="Serial number" htmlFor="serialNumber" required error={fields.serialNumber}>
            <input
              id="serialNumber"
              name="serialNumber"
              required
              autoFocus
              autoCapitalize="characters"
              defaultValue={ocrPrefill?.serialNumber ?? undefined}
              placeholder="HE-2025-04412"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

          <Field
            label="G-Number"
            htmlFor="gNumber"
            error={fields.gNumber}
            hint="Leave blank if it has not been issued yet."
          >
            <input
              id="gNumber"
              name="gNumber"
              value={gNumber}
              onChange={(e) => setGNumber(e.target.value)}
              placeholder="G-2026-00001"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

          <Field label="Manufacturer" htmlFor="manufacturerId" required error={fields.manufacturerId}>
            <select
              id="manufacturerId"
              name="manufacturerId"
              value={manufacturerId}
              onChange={(e) => setManufacturerId(e.target.value)}
              required
              className={inputClass}
            >
              {manufacturers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Year of manufacture" htmlFor="yearOfManufacture" required error={fields.yearOfManufacture}>
            <input
              id="yearOfManufacture"
              name="yearOfManufacture"
              type="number"
              inputMode="numeric"
              required
              defaultValue={ocrPrefill?.yearOfManufacture ?? new Date().getFullYear()}
              min={1950}
              max={new Date().getFullYear()}
              className={inputClass}
            />
          </Field>
        </div>

        {chosen && (
          <p className="mt-4 rounded-xl border border-kplc/15 bg-kplc/5 px-4 py-3 text-xs text-navy">
            <strong>{chosen.name}</strong> gives {chosen.warrantyMonths} months of
            warranty. The clock starts <strong>today</strong>, the day KPLC takes
            delivery — not the date of manufacture.
          </p>
        )}
      </FormSection>

      <FormSection title="Nameplate specification">
        <div key={formKey} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Rating" htmlFor="ratingKva" required error={fields.ratingKva}>
            <div className="relative">
              <input
                id="ratingKva"
                name="ratingKva"
                type="number"
                inputMode="numeric"
                required
                list="ratings"
                defaultValue={ocrPrefill?.ratingKva ?? undefined}
                placeholder="100"
                className={`${inputClass} pr-14`}
              />
              <datalist id="ratings">
                {RATINGS.map((r) => <option key={r} value={r} />)}
              </datalist>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft">
                kVA
              </span>
            </div>
          </Field>

          <Field label="Primary voltage" htmlFor="primaryKv" required error={fields.primaryKv}>
            <div className="relative">
              <input id="primaryKv" name="primaryKv" type="number" step="0.001" required defaultValue={ocrPrefill?.primaryKv ?? 11} className={`${inputClass} pr-12`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft">kV</span>
            </div>
          </Field>

          <Field label="Secondary voltage" htmlFor="secondaryKv" required error={fields.secondaryKv}>
            <div className="relative">
              <input id="secondaryKv" name="secondaryKv" type="number" step="0.001" required defaultValue={ocrPrefill?.secondaryKv ?? 0.415} className={`${inputClass} pr-12`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft">kV</span>
            </div>
          </Field>

          <Field label="Phases" htmlFor="phases" required error={fields.phases}>
            <select id="phases" name="phases" defaultValue={3} className={inputClass}>
              <option value={3}>3 phase</option>
              <option value={1}>1 phase</option>
            </select>
          </Field>

          <Field label="Cooling" htmlFor="coolingType" required error={fields.coolingType}>
            <select id="coolingType" name="coolingType" defaultValue={ocrPrefill?.coolingType ?? "ONAN"} className={inputClass}>
              {COOLING.map((c) => <option key={c} value={c}>{c}</option>)}
              {ocrPrefill?.coolingType && !COOLING.includes(ocrPrefill.coolingType) && (
                <option value={ocrPrefill.coolingType}>{ocrPrefill.coolingType}</option>
              )}
            </select>
          </Field>

          <Field label="Vector group" htmlFor="vectorGroup" error={fields.vectorGroup}>
            <input id="vectorGroup" name="vectorGroup" defaultValue={ocrPrefill?.vectorGroup ?? undefined} placeholder="Dyn11" className={inputClass} />
          </Field>

          <Field label="Impedance" htmlFor="impedancePct" error={fields.impedancePct}>
            <div className="relative">
              <input id="impedancePct" name="impedancePct" type="number" step="0.1" defaultValue={ocrPrefill?.impedancePct ?? undefined} placeholder="4.5" className={`${inputClass} pr-10`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft">%</span>
            </div>
          </Field>

          <Field label="Oil volume" htmlFor="oilVolumeLitres" error={fields.oilVolumeLitres}>
            <div className="relative">
              <input id="oilVolumeLitres" name="oilVolumeLitres" type="number" inputMode="numeric" defaultValue={ocrPrefill?.oilVolumeLitres ?? undefined} placeholder="65" className={`${inputClass} pr-14`} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft">litres</span>
            </div>
          </Field>
        </div>
      </FormSection>

      <details className="rounded-2xl border border-line bg-white" open={Boolean(ocrPrefill?.frequencyHz || ocrPrefill?.totalWeightKg)}>
        <summary className="cursor-pointer px-5 py-4 text-sm font-bold text-navy">
          Full nameplate details (optional)
          <span className="ml-2 font-normal text-ink-soft">
            frequency, BIL, temp class, oil type, weights, taps
          </span>
        </summary>
        <div className="border-t border-line p-5 sm:p-6">
          <NameplateFields
            key={formKey}
            defaults={{ frequencyHz: ocrPrefill?.frequencyHz, totalWeightKg: ocrPrefill?.totalWeightKg }}
          />
        </div>
      </details>

      <FormSection
        title="Delivery"
        description={`Who brought it into ${storeName}, and on what.`}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Delivery note reference" htmlFor="deliveryNoteRef" error={fields.deliveryNoteRef}>
            <input id="deliveryNoteRef" name="deliveryNoteRef" placeholder="DN-88214" className={inputClass} />
          </Field>

          <Field label="Vehicle plate" htmlFor="vehiclePlate" error={fields.vehiclePlate}>
            <input id="vehiclePlate" name="vehiclePlate" placeholder="KDG 456T" className={`${inputClass} uppercase`} />
          </Field>

          <Field label="Driver name" htmlFor="driverName" error={fields.driverName}>
            <input id="driverName" name="driverName" placeholder="Peter Mwangi" className={inputClass} />
          </Field>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          {ocrPrefill && (
            <p className="mb-2 text-[11px] font-semibold text-kplc">
              ✓ The photo from your nameplate scan is already attached.
            </p>
          )}
          <PhotoUpload
            value={photoUrls}
            onChange={setPhotoUrls}
            max={4}
            label="Nameplate photo"
            hint="Photograph the rating plate. It settles any later dispute about what this unit actually is."
          />
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <DocumentUpload
            value={fatReportUrl}
            onChange={setFatReportUrl}
            label="Attach FAT Report"
            hint="The manufacturer's factory acceptance test report, if one came with delivery. PDF, JPG or PNG, up to 10 MB."
          />
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-semibold text-navy transition-colors hover:border-navy/30"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light disabled:opacity-50"
        >
          {busy ? "Registering…" : "Register and test"}
        </button>
      </div>
    </form>
    )}
    </div>
  );
}
