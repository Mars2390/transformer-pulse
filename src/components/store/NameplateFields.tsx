"use client";

import { Field, inputClass } from "@/components/ui/Field";

/**
 * The full-nameplate inputs, beyond the core electricals. Uncontrolled
 * (defaultValue) so both the receive form and the edit form can drop them into
 * their existing FormData submission. Everything here is optional — a rusty
 * plate may not be fully legible, and pretending otherwise would be dishonest.
 */
export type NameplateDefaults = Partial<{
  frequencyHz: number | null;
  duty: string | null;
  standardRef: string | null;
  hvInsulationLevelKv: string | null;
  tempRiseOilC: number | null;
  tempRiseWindingC: number | null;
  tempClass: string | null;
  maxAmbientTempC: number | null;
  insulationOilType: string | null;
  oilWeightKg: number | null;
  totalWeightKg: number | null;
  tapRange: string | null;
}>;

const v = (x: unknown) => (x == null ? "" : String(x));

export function NameplateFields({ defaults = {} }: { defaults?: NameplateDefaults }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Frequency (Hz)" htmlFor="frequencyHz">
        <input id="frequencyHz" name="frequencyHz" type="number" defaultValue={v(defaults.frequencyHz) || "50"} className={inputClass} />
      </Field>
      <Field label="Duty" htmlFor="duty">
        <input id="duty" name="duty" defaultValue={v(defaults.duty)} placeholder="CONT" className={inputClass} />
      </Field>
      <Field label="Standard" htmlFor="standardRef">
        <input id="standardRef" name="standardRef" defaultValue={v(defaults.standardRef)} placeholder="IEC 60076" className={inputClass} />
      </Field>
      <Field label="HV insulation level / BIL" htmlFor="hvInsulationLevelKv">
        <input id="hvInsulationLevelKv" name="hvInsulationLevelKv" defaultValue={v(defaults.hvInsulationLevelKv)} placeholder="125/50" className={inputClass} />
      </Field>
      <Field label="Temp rise — oil (°C)" htmlFor="tempRiseOilC">
        <input id="tempRiseOilC" name="tempRiseOilC" type="number" defaultValue={v(defaults.tempRiseOilC)} placeholder="60" className={inputClass} />
      </Field>
      <Field label="Temp rise — winding (°C)" htmlFor="tempRiseWindingC">
        <input id="tempRiseWindingC" name="tempRiseWindingC" type="number" defaultValue={v(defaults.tempRiseWindingC)} placeholder="65" className={inputClass} />
      </Field>
      <Field label="Temperature class" htmlFor="tempClass">
        <input id="tempClass" name="tempClass" defaultValue={v(defaults.tempClass)} placeholder="A" className={inputClass} />
      </Field>
      <Field label="Max ambient temp (°C)" htmlFor="maxAmbientTempC">
        <input id="maxAmbientTempC" name="maxAmbientTempC" type="number" defaultValue={v(defaults.maxAmbientTempC)} placeholder="40" className={inputClass} />
      </Field>
      <Field label="Insulation oil type" htmlFor="insulationOilType">
        <input id="insulationOilType" name="insulationOilType" defaultValue={v(defaults.insulationOilType)} placeholder="Nytro 10GBNP" className={inputClass} />
      </Field>
      <Field label="Oil weight (kg)" htmlFor="oilWeightKg">
        <input id="oilWeightKg" name="oilWeightKg" type="number" defaultValue={v(defaults.oilWeightKg)} placeholder="2200" className={inputClass} />
      </Field>
      <Field label="Total weight (kg)" htmlFor="totalWeightKg">
        <input id="totalWeightKg" name="totalWeightKg" type="number" defaultValue={v(defaults.totalWeightKg)} placeholder="10000" className={inputClass} />
      </Field>
      <Field label="Tap range" htmlFor="tapRange" className="sm:col-span-2 lg:col-span-3">
        <input id="tapRange" name="tapRange" defaultValue={v(defaults.tapRange)} placeholder="22550 – 20350 V (5 off-circuit taps)" className={inputClass} />
      </Field>
    </div>
  );
}
