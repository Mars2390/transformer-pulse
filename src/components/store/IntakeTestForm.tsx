"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Field,
  FormError,
  FormSection,
  Measurement,
  inputClass,
} from "@/components/ui/Field";

/**
 * The intake test.
 *
 * Thresholds follow common utility practice for oil-immersed distribution
 * transformers — IEC 60076 for ratio, IEC 60422 for oil. CONFIRM THEM AGAINST
 * KPLC'S OWN TESTING STANDARD before the conference: if your numbers differ
 * from the book in the room, someone will say so.
 */
const LIMITS = {
  insulationMinMohm: 100,
  oilBdvMinKv: 30,
  ratioMaxDeviationPct: 0.5,
};

type Values = Record<string, string>;

const CHECKS = [
  { name: "tankCondition", label: "Tank condition", options: ["GOOD", "DAMAGED"], bad: "DAMAGED" },
  { name: "bushings", label: "Bushings", options: ["GOOD", "DAMAGED"], bad: "DAMAGED" },
  { name: "silicaGel", label: "Silica gel", options: ["BLUE", "PINK", "WHITE"], bad: "PINK" },
  { name: "oilLevel", label: "Oil level", options: ["NORMAL", "LOW"], bad: "LOW" },
  { name: "nameplateLegible", label: "Nameplate legible", options: ["YES", "NO"], bad: "NO" },
] as const;

export function IntakeTestForm({
  transformerId,
  gNumber,
  serialNumber,
}: {
  transformerId: string;
  gNumber: string | null;
  serialNumber: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<Values>({
    insulationResistanceHvMohm: "",
    insulationResistanceLvMohm: "",
    turnsRatio: "",
    turnsRatioDeviationPct: "",
    windingResistanceHvOhm: "",
    windingResistanceLvOhm: "",
    oilBdvKv: "",
    oilTempC: "",
    ambientTempC: "",
  });

  const [visual, setVisual] = useState<Record<string, string>>({
    tankCondition: "GOOD",
    bushings: "GOOD",
    silicaGel: "BLUE",
    oilLevel: "NORMAL",
    nameplateLegible: "YES",
  });

  const [polarityOk, setPolarityOk] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [passed, setPassed] = useState(true);

  const set = (name: string) => (value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

  /**
   * What the standards say about the numbers entered so far.
   *
   * This is advice, not a verdict. The store keeper sets pass/fail themselves —
   * because a real transformer can breach one limit and still be serviceable,
   * and if the form overruled them they would type a passing number to get
   * past it. That is the exact dishonesty this system exists to end.
   */
  const breaches = useMemo(() => {
    const list: string[] = [];
    const n = (k: string) => (values[k] === "" ? null : Number(values[k]));

    const irHv = n("insulationResistanceHvMohm");
    const irLv = n("insulationResistanceLvMohm");
    const bdv = n("oilBdvKv");
    const dev = n("turnsRatioDeviationPct");

    if (irHv != null && irHv < LIMITS.insulationMinMohm)
      list.push(`HV insulation ${irHv} MΩ is below the ${LIMITS.insulationMinMohm} MΩ minimum.`);
    if (irLv != null && irLv < LIMITS.insulationMinMohm)
      list.push(`LV insulation ${irLv} MΩ is below the ${LIMITS.insulationMinMohm} MΩ minimum.`);
    if (bdv != null && bdv < LIMITS.oilBdvMinKv)
      list.push(`Oil BDV ${bdv} kV is below the ${LIMITS.oilBdvMinKv} kV minimum.`);
    if (dev != null && Math.abs(dev) > LIMITS.ratioMaxDeviationPct)
      list.push(`Turns ratio deviates ${dev}%, over the ${LIMITS.ratioMaxDeviationPct}% limit.`);
    if (!polarityOk) list.push("Polarity / vector group check failed.");

    for (const check of CHECKS) {
      if (visual[check.name] === check.bad)
        list.push(`${check.label}: ${visual[check.name].toLowerCase()}.`);
    }
    return list;
  }, [values, visual, polarityOk]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const numeric = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === "" ? null : Number(v)]),
    );

    const response = await fetch(`/api/transformers/${transformerId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        values: { ...numeric, stage: "STORE_INTAKE", polarityOk, passed, remarks },
        visual,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not record this test.");
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

      <FormSection
        title="Electrical measurements"
        description="Leave a field blank if the test was not performed. Do not guess."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Measurement
            name="insulationResistanceHvMohm"
            label="Insulation resistance HV–earth"
            unit="MΩ"
            limit={{ min: LIMITS.insulationMinMohm }}
            value={values.insulationResistanceHvMohm}
            onChange={set("insulationResistanceHvMohm")}
            step="1"
          />
          <Measurement
            name="insulationResistanceLvMohm"
            label="Insulation resistance LV–earth"
            unit="MΩ"
            limit={{ min: LIMITS.insulationMinMohm }}
            value={values.insulationResistanceLvMohm}
            onChange={set("insulationResistanceLvMohm")}
            step="1"
          />
          <Measurement
            name="oilBdvKv"
            label="Oil breakdown voltage"
            unit="kV"
            limit={{ min: LIMITS.oilBdvMinKv }}
            value={values.oilBdvKv}
            onChange={set("oilBdvKv")}
            step="0.1"
          />
          <Measurement
            name="turnsRatio"
            label="Turns ratio (measured)"
            unit=":1"
            value={values.turnsRatio}
            onChange={set("turnsRatio")}
            step="0.001"
          />
          <Measurement
            name="turnsRatioDeviationPct"
            label="Ratio deviation from nameplate"
            unit="%"
            limit={{ maxAbs: LIMITS.ratioMaxDeviationPct }}
            value={values.turnsRatioDeviationPct}
            onChange={set("turnsRatioDeviationPct")}
            step="0.01"
          />
          <Measurement
            name="windingResistanceHvOhm"
            label="Winding resistance HV"
            unit="Ω"
            value={values.windingResistanceHvOhm}
            onChange={set("windingResistanceHvOhm")}
            step="0.001"
          />
          <Measurement
            name="windingResistanceLvOhm"
            label="Winding resistance LV"
            unit="Ω"
            value={values.windingResistanceLvOhm}
            onChange={set("windingResistanceLvOhm")}
            step="0.0001"
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

        <div className="mt-5 border-t border-line pt-5">
          <p className="text-xs font-bold text-navy">Polarity &amp; vector group</p>
          <div className="mt-2 flex gap-2">
            {[
              { value: true, label: "Correct" },
              { value: false, label: "Failed" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setPolarityOk(option.value)}
                className={`rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
                  polarityOk === option.value
                    ? option.value
                      ? "bg-emerald-600 text-white"
                      : "bg-red-600 text-white"
                    : "border border-line bg-white text-ink-soft hover:border-navy/30"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </FormSection>

      <FormSection title="Visual inspection">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CHECKS.map((check) => (
            <div key={check.name}>
              <p className="text-xs font-bold text-navy">{check.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {check.options.map((option) => {
                  const active = visual[check.name] === option;
                  const isBad = option === check.bad;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setVisual((v) => ({ ...v, [check.name]: option }))}
                      className={`rounded-lg px-3 py-2 text-xs font-bold capitalize transition-colors ${
                        active
                          ? isBad
                            ? "bg-red-600 text-white"
                            : "bg-kplc text-white"
                          : "border border-line bg-white text-ink-soft hover:border-navy/30"
                      }`}
                    >
                      {option.toLowerCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection title="Result">
        {breaches.length > 0 && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold text-amber-900">
              {breaches.length} reading{breaches.length === 1 ? "" : "s"} outside the standard:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-800">
              {breaches.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        )}

        <p className="text-xs font-bold text-navy">Overall result</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPassed(true)}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              passed
                ? "border-emerald-500 bg-emerald-50"
                : "border-line bg-white hover:border-emerald-300"
            }`}
          >
            <span className={`block text-sm font-bold ${passed ? "text-emerald-800" : "text-navy"}`}>
              Passed
            </span>
            <span className="mt-0.5 block text-xs text-ink-soft">
              Cleared for dispatch to the field.
            </span>
          </button>

          <button
            type="button"
            onClick={() => setPassed(false)}
            className={`rounded-xl border-2 p-4 text-left transition-all ${
              !passed ? "border-red-500 bg-red-50" : "border-line bg-white hover:border-red-300"
            }`}
          >
            <span className={`block text-sm font-bold ${!passed ? "text-red-800" : "text-navy"}`}>
              Failed
            </span>
            <span className="mt-0.5 block text-xs text-ink-soft">
              Withheld. The system will refuse to dispatch it.
            </span>
          </button>
        </div>

        {passed && breaches.length > 0 && (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-900">
            You are passing a unit with {breaches.length} reading
            {breaches.length === 1 ? "" : "s"} outside the standard. That is your
            call to make — it will be recorded against your name, permanently.
          </p>
        )}

        <div className="mt-5">
          <Field label="Remarks" htmlFor="remarks" hint="Anything the numbers do not say.">
            <textarea
              id="remarks"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className={inputClass}
              placeholder="Minor paint damage on the tank lid, noted for repainting."
            />
          </Field>
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-soft">
          Recording against{" "}
          <span className="font-mono font-bold text-navy">
            {gNumber ?? serialNumber}
          </span>
          . This cannot be edited afterwards.
        </p>
        <div className="flex gap-3">
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
            className="rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light disabled:opacity-50"
          >
            {busy ? "Recording…" : "Record test"}
          </button>
        </div>
      </div>
    </form>
  );
}
