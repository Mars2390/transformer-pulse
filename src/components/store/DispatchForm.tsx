"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, FormSection, inputClass } from "@/components/ui/Field";
import { PhotoUpload } from "@/components/ui/PhotoUpload";

export function DispatchForm({
  transformerId,
  gNumber,
  serialNumber,
  ratingKva,
  regions,
  defaultRegion,
}: {
  transformerId: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  regions: string[];
  defaultRegion: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [plate, setPlate] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    const form = new FormData(event.currentTarget);
    const payload = { ...Object.fromEntries(form.entries()), photoUrls };

    const response = await fetch(`/api/transformers/${transformerId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not dispatch this transformer.");
      setFields(data.fields ?? {});
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    router.push("/store/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <FormError message={error} />}

      <div className="rounded-2xl border border-kplc/15 bg-kplc/5 px-5 py-4">
        <p className="text-xs font-bold tracking-[0.1em] text-kplc">DISPATCHING</p>
        <p className="mt-1 font-mono text-lg font-bold text-navy">
          {gNumber ?? serialNumber}
        </p>
        <p className="text-xs text-ink-soft">
          {ratingKva} kVA · once dispatched it appears on the field engineer&apos;s
          phone immediately.
        </p>
      </div>

      <FormSection title="Destination">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Site or area"
            htmlFor="destination"
            required
            error={fields.destination}
            className="sm:col-span-2"
          >
            <input
              id="destination"
              name="destination"
              required
              autoFocus
              placeholder="Kabete Primary School"
              className={inputClass}
            />
          </Field>

          <Field label="Region" htmlFor="region" required error={fields.region}>
            <select id="region" name="region" defaultValue={defaultRegion} className={inputClass}>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>

          <Field label="County" htmlFor="county" error={fields.county}>
            <input id="county" name="county" placeholder="Nairobi" className={inputClass} />
          </Field>

          <Field
            label="Expected arrival"
            htmlFor="expectedArrival"
            error={fields.expectedArrival}
            className="sm:col-span-2"
          >
            <input
              id="expectedArrival"
              name="expectedArrival"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputClass}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Vehicle and driver"
        description="This is the part paper always loses. If it goes missing, this is who had it."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Vehicle plate"
            htmlFor="vehiclePlate"
            required
            error={fields.vehiclePlate}
            hint="Kenyan format, e.g. KDG 456T"
          >
            <input
              id="vehiclePlate"
              name="vehiclePlate"
              required
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="KDG 456T"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

          <Field label="Driver name" htmlFor="driverName" required error={fields.driverName}>
            <input id="driverName" name="driverName" required placeholder="Peter Mwangi" className={inputClass} />
          </Field>

          <Field label="Driver phone" htmlFor="driverPhone" error={fields.driverPhone}>
            <input id="driverPhone" name="driverPhone" inputMode="tel" placeholder="0722123456" className={inputClass} />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Notes" htmlFor="notes" error={fields.notes}>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Escort assigned. Crane booked for Thursday morning."
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <PhotoUpload
            value={photoUrls}
            onChange={setPhotoUrls}
            max={3}
            label="Loaded vehicle (optional)"
            hint="A photo of the unit on the lorry, before it leaves the yard."
          />
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/store/dashboard")}
          className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-semibold text-navy transition-colors hover:border-navy/30"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gold px-6 py-3 text-sm font-bold text-navy-dark shadow-lg shadow-gold/20 transition-colors hover:bg-gold-dark disabled:opacity-50"
        >
          {busy ? "Dispatching…" : "Dispatch to field"}
        </button>
      </div>
    </form>
  );
}
