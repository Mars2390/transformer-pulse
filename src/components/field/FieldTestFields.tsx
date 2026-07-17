"use client";

import { Measurement } from "@/components/ui/Field";
import { IR_MIN_MOHM, OIL_BDV_MIN_KV, RATIO_MAX_DEVIATION_PCT } from "@/lib/health";

export type TestValues = Record<string, string>;

export const emptyTest: TestValues = {
  insulationResistanceHvMohm: "",
  insulationResistanceLvMohm: "",
  turnsRatioDeviationPct: "",
  oilBdvKv: "",
  oilTempC: "",
  ambientTempC: "",
};

/**
 * The measurement inputs shared by install, inspect and fault. `variant`
 * decides which fields appear — a commissioning test wants turns ratio, a
 * routine inspection does not — but they all use the same live-limit inputs so
 * a bad reading is flagged (never blocked) at the pole.
 */
export function FieldTestFields({
  values,
  onChange,
  variant,
}: {
  values: TestValues;
  onChange: (values: TestValues) => void;
  variant: "install" | "inspect" | "fault";
}) {
  const set = (name: string) => (v: string) => onChange({ ...values, [name]: v });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Measurement
        name="insulationResistanceHvMohm"
        label="Insulation resistance HV–earth"
        unit="MΩ"
        limit={{ min: IR_MIN_MOHM }}
        value={values.insulationResistanceHvMohm}
        onChange={set("insulationResistanceHvMohm")}
        step="1"
      />
      <Measurement
        name="insulationResistanceLvMohm"
        label="Insulation resistance LV–earth"
        unit="MΩ"
        limit={{ min: IR_MIN_MOHM }}
        value={values.insulationResistanceLvMohm}
        onChange={set("insulationResistanceLvMohm")}
        step="1"
      />
      {variant === "install" && (
        <Measurement
          name="turnsRatioDeviationPct"
          label="Turns ratio deviation"
          unit="%"
          limit={{ maxAbs: RATIO_MAX_DEVIATION_PCT }}
          value={values.turnsRatioDeviationPct}
          onChange={set("turnsRatioDeviationPct")}
          step="0.01"
        />
      )}
      <Measurement
        name="oilBdvKv"
        label="Oil breakdown voltage"
        unit="kV"
        limit={{ min: OIL_BDV_MIN_KV }}
        value={values.oilBdvKv}
        onChange={set("oilBdvKv")}
        step="0.1"
      />
      <Measurement
        name="oilTempC"
        label="Oil temperature"
        unit="°C"
        value={values.oilTempC}
        onChange={set("oilTempC")}
        step="0.1"
      />
      <Measurement
        name="ambientTempC"
        label="Ambient temperature"
        unit="°C"
        value={values.ambientTempC}
        onChange={set("ambientTempC")}
        step="0.1"
      />
    </div>
  );
}

/** Turns the string map into the numeric payload the API expects. */
export function toTestPayload(values: TestValues): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = value === "" ? null : Number(value);
  }
  return out;
}
