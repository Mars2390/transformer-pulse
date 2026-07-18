"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, FormSection, inputClass } from "@/components/ui/Field";
import { NameplateFields, type NameplateDefaults } from "@/components/store/NameplateFields";

export type EditDefaults = NameplateDefaults & {
  ratingKva: number;
  primaryKv: number;
  secondaryKv: number;
  phases: number;
  coolingType: string;
  impedancePct: number | null;
  vectorGroup: string | null;
  oilVolumeLitres: number | null;
  yearOfManufacture: number;
};

const COOLING = ["ONAN", "ONAF", "AN", "AF"];

/**
 * Correct or complete a registered transformer's nameplate. Submits to
 * PATCH /api/transformers/[id], which audits the change and leaves the custody
 * chain untouched.
 */
export function EditTransformerForm({
  transformerId,
  label,
  defaults,
}: {
  transformerId: string;
  label: string;
  defaults: EditDefaults;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const v = (x: unknown) => (x == null ? "" : String(x));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());

    const response = await fetch(`/api/transformers/${transformerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not save.");
      setFields(data.fields ?? {});
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push(`/transformers/${transformerId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <FormError message={error} />}
      <p className="rounded-xl bg-kplc/5 px-4 py-3 text-xs text-navy">
        Editing the nameplate of <span className="font-mono font-bold">{label}</span>.
        This corrects physical facts about the unit. It does <strong>not</strong>{" "}
        change its history — the custody chain stays sealed, and the change is
        recorded in the audit log.
      </p>

      <FormSection title="Core specification">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Rating (kVA)" htmlFor="ratingKva" required error={fields.ratingKva}>
            <input id="ratingKva" name="ratingKva" type="number" required defaultValue={v(defaults.ratingKva)} className={inputClass} />
          </Field>
          <Field label="Primary (kV)" htmlFor="primaryKv" required error={fields.primaryKv}>
            <input id="primaryKv" name="primaryKv" type="number" step="0.001" required defaultValue={v(defaults.primaryKv)} className={inputClass} />
          </Field>
          <Field label="Secondary (kV)" htmlFor="secondaryKv" required error={fields.secondaryKv}>
            <input id="secondaryKv" name="secondaryKv" type="number" step="0.001" required defaultValue={v(defaults.secondaryKv)} className={inputClass} />
          </Field>
          <Field label="Phases" htmlFor="phases" required>
            <select id="phases" name="phases" defaultValue={v(defaults.phases)} className={inputClass}>
              <option value={3}>3 phase</option>
              <option value={1}>1 phase</option>
            </select>
          </Field>
          <Field label="Cooling" htmlFor="coolingType" required>
            <select id="coolingType" name="coolingType" defaultValue={defaults.coolingType} className={inputClass}>
              {COOLING.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Vector group" htmlFor="vectorGroup">
            <input id="vectorGroup" name="vectorGroup" defaultValue={v(defaults.vectorGroup)} placeholder="Dyn11" className={inputClass} />
          </Field>
          <Field label="Impedance (%)" htmlFor="impedancePct">
            <input id="impedancePct" name="impedancePct" type="number" step="0.1" defaultValue={v(defaults.impedancePct)} className={inputClass} />
          </Field>
          <Field label="Oil volume (litres)" htmlFor="oilVolumeLitres">
            <input id="oilVolumeLitres" name="oilVolumeLitres" type="number" defaultValue={v(defaults.oilVolumeLitres)} className={inputClass} />
          </Field>
          <Field label="Year of manufacture" htmlFor="yearOfManufacture" required error={fields.yearOfManufacture}>
            <input id="yearOfManufacture" name="yearOfManufacture" type="number" required defaultValue={v(defaults.yearOfManufacture)} className={inputClass} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Full nameplate">
        <NameplateFields defaults={defaults} />
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={() => router.back()} className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-semibold text-navy transition-colors hover:border-navy/30">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light disabled:opacity-50">
          {busy ? "Saving…" : "Save nameplate"}
        </button>
      </div>
    </form>
  );
}
