"use client";

import { Field, inputClass } from "@/components/ui/Field";

/**
 * The five IEC 60076-7 thermal constants, off the manufacturer's TEST
 * CERTIFICATE rather than off the nameplate.
 *
 * All optional, and blank genuinely means blank: the engine falls back to the
 * IEC 60076-7 Table 4 values for an ONAN distribution unit, which is what the
 * report will then say it used. Nobody is being asked to invent a number to get
 * past a form.
 *
 * The placeholders are the IEC defaults, so a storekeeper can see what will be
 * assumed if the box is left empty. That is the whole design intent: make the
 * assumption visible instead of burying it in a constant.
 */
export type ThermalConstantDefaults = Partial<{
  lossRatioR: number | null;
  topOilRiseK: number | null;
  hotSpotGradientK: number | null;
  windingExponentX: number | null;
  oilExponentY: number | null;
}>;

const v = (x: unknown) => (x == null ? "" : String(x));

export function ThermalConstantFields({
  defaults = {},
  showExponents = true,
}: {
  defaults?: ThermalConstantDefaults;
  /** The two exponents are cooling-class properties and rarely differ. */
  showExponents?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-ink-soft">
        From the manufacturer&apos;s test certificate, not the nameplate. Leave any box blank and the
        thermal model uses the IEC 60076-7 Table 4 value for an ONAN distribution transformer
        (shown as the placeholder). Whatever is used is printed on the load report, so the
        assumption is never hidden.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Label carries the guidance: the Field component takes label + children only. */}
        <Field label="Loss ratio R — load loss / no-load loss at rated (IEC default 5)" htmlFor="lossRatioR">
          <input
            id="lossRatioR"
            name="lossRatioR"
            type="number"
            step="0.1"
            min="0.5"
            max="25"
            defaultValue={v(defaults.lossRatioR)}
            placeholder="5"
            className={inputClass}
          />
        </Field>

        <Field label="Top-oil rise at rated load, K — temperature-rise test (IEC default 55)" htmlFor="topOilRiseK">
          <input
            id="topOilRiseK"
            name="topOilRiseK"
            type="number"
            step="0.1"
            min="20"
            max="90"
            defaultValue={v(defaults.topOilRiseK)}
            placeholder="55"
            className={inputClass}
          />
        </Field>

        <Field label="Hot-spot gradient at rated load, K — hot-spot factor included (IEC default 23)" htmlFor="hotSpotGradientK">
          <input
            id="hotSpotGradientK"
            name="hotSpotGradientK"
            type="number"
            step="0.1"
            min="5"
            max="60"
            defaultValue={v(defaults.hotSpotGradientK)}
            placeholder="23"
            className={inputClass}
          />
        </Field>

        {showExponents ? (
          <>
            <Field label="Oil-rise exponent, IEC x — cooling class (ONAN default 0.8)" htmlFor="windingExponentX">
              <input
                id="windingExponentX"
                name="windingExponentX"
                type="number"
                step="0.05"
                min="0.2"
                max="1.5"
                defaultValue={v(defaults.windingExponentX)}
                placeholder="0.8"
                className={inputClass}
              />
            </Field>

            <Field label="Winding exponent, IEC y — cooling class (ONAN default 1.6)" htmlFor="oilExponentY">
              <input
                id="oilExponentY"
                name="oilExponentY"
                type="number"
                step="0.05"
                min="0.5"
                max="2.5"
                defaultValue={v(defaults.oilExponentY)}
                placeholder="1.6"
                className={inputClass}
              />
            </Field>
          </>
        ) : null}
      </div>

      {showExponents ? (
        <p className="text-[11px] leading-snug text-ink-soft">
          Note on the two exponent field names: IEC 60076-7 calls x the oil exponent and y the
          winding exponent. The database columns are named windingExponentX and oilExponentY, which
          pairs each letter with the opposite word. The values and the equations follow the
          standard — see the naming note in src/lib/thermal-constants.ts.
        </p>
      ) : null}
    </div>
  );
}
