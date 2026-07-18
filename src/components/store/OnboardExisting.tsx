"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OnboardMap, type ExistingPin } from "./OnboardMap";
import { DATA_SOURCE_META } from "@/lib/format";

type Manufacturer = { id: string; name: string };

const RATINGS = [50, 100, 200, 315, 500, 1000];
const MOUNTINGS: [string, string][] = [
  ["POLE_MOUNTED", "Pole-mounted"],
  ["GROUND_MOUNTED", "Ground-mounted"],
  ["PAD_MOUNTED", "Pad-mounted"],
  ["SUBSTATION", "Substation"],
];
const SOURCES: [string, string][] = [
  ["MANUAL_PIN", "Manual pin"],
  ["OSM_SURVEYED", "OpenStreetMap — surveyed"],
  ["OSM_INFERRED", "OpenStreetMap — inferred"],
];

export function OnboardExisting({
  manufacturers,
  existing,
  keeperName,
  suggestedGNumber,
  region,
}: {
  manufacturers: Manufacturer[];
  existing: ExistingPin[];
  keeperName: string;
  suggestedGNumber: string;
  region: string | null;
}) {
  const router = useRouter();
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const [form, setForm] = useState({
    locationDescription: "",
    gNumber: suggestedGNumber,
    serialNumber: "",
    manufacturerId: "",
    ratingKva: "200",
    mountingType: "POLE_MOUNTED",
    yearOfManufacture: "",
    dataSource: "MANUAL_PIN",
    region: region ?? "",
    feeder: "",
    notes: "",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Default to the "Unknown" manufacturer when one exists — the honest answer
  // for a unit whose plate cannot be read from the ground.
  useEffect(() => {
    if (form.manufacturerId) return;
    const unknown = manufacturers.find((m) => /unknown/i.test(m.name));
    set("manufacturerId", unknown?.id ?? manufacturers[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manufacturers]);

  const autoNotes = `Onboarded via map pin by ${keeperName}. Requires physical inspection.`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) {
      setError("Place a pin on the map first — the position is the one thing this record cannot do without.");
      return;
    }
    setSaving(true);
    setError(null);
    setFields({});

    const res = await fetch("/api/transformers/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        lat: pin.lat,
        lng: pin.lng,
        ratingKva: Number(form.ratingKva),
        yearOfManufacture: form.yearOfManufacture ? Number(form.yearOfManufacture) : undefined,
        notes: form.notes || autoNotes,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "That did not save.");
      setFields(data.fields ?? {});
      return;
    }

    setToast(data.message ?? `${data.transformer?.gNumber} onboarded.`);
    router.refresh();
  }

  /** Keep the map where it is; clear the identity fields for the next unit. */
  function onboardAnother() {
    setToast(null);
    setPin(null);
    setForm((f) => ({
      ...f,
      locationDescription: "",
      gNumber: "",
      serialNumber: "",
      yearOfManufacture: "",
      notes: "",
    }));
  }

  const source = DATA_SOURCE_META[form.dataSource];

  return (
    <div className="flex h-[100dvh] flex-col bg-surface-2 lg:flex-row">
      {/* ---------- LEFT: map ------------------------------------------------ */}
      <div className="relative h-[45vh] shrink-0 border-b border-line lg:h-auto lg:w-[60%] lg:border-b-0 lg:border-r">
        <OnboardMap pin={pin} onPick={(lat, lng) => setPin({ lat, lng })} existing={existing} />
      </div>

      {/* ---------- RIGHT: form ---------------------------------------------- */}
      <div className="flex min-h-0 flex-1 flex-col lg:w-[40%]">
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-3">
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-navy">Onboard existing transformer</h1>
            <p className="text-[11px] text-ink-soft">Already on a pole — not passing through the store.</p>
          </div>
          <Link href="/store/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
            Close
          </Link>
        </div>

        {toast ? (
          /* --- Success ----------------------------------------------------- */
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-kplc/10 text-2xl">✅</div>
            <p className="text-sm font-bold text-navy">{toast}</p>
            <p className="max-w-xs text-xs text-ink-soft">
              It is on the map now, carrying a demonstration-data badge until a field engineer inspects it.
            </p>
            <div className="flex w-full max-w-xs flex-col gap-2">
              <button
                onClick={onboardAnother}
                className="rounded-xl bg-kplc px-5 py-3 text-sm font-bold text-white hover:bg-kplc-dark"
              >
                Onboard another
              </button>
              <Link
                href="/store/dashboard"
                className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy hover:border-kplc"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                  {error}
                </p>
              )}

              <Field label="Location description" hint="A road, a landmark, a plot." error={fields.locationDescription}>
                <input
                  value={form.locationDescription}
                  onChange={(e) => set("locationDescription", e.target.value)}
                  placeholder="Opposite Sarit Centre, Lower Kabete Road"
                  className={inputCls}
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="G-Number" error={fields.gNumber}>
                  <input value={form.gNumber} onChange={(e) => set("gNumber", e.target.value)} className={inputCls} />
                </Field>
                <Field label="Serial number" hint="Blank if you cannot read it." error={fields.serialNumber}>
                  <input
                    value={form.serialNumber}
                    onChange={(e) => set("serialNumber", e.target.value)}
                    placeholder="Not visible"
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Manufacturer" error={fields.manufacturerId}>
                <select value={form.manufacturerId} onChange={(e) => set("manufacturerId", e.target.value)} className={inputCls}>
                  {manufacturers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Estimated rating" error={fields.ratingKva}>
                  <select value={form.ratingKva} onChange={(e) => set("ratingKva", e.target.value)} className={inputCls}>
                    {RATINGS.map((r) => <option key={r} value={r}>{r} kVA</option>)}
                  </select>
                </Field>
                <Field label="Type" error={fields.mountingType}>
                  <select value={form.mountingType} onChange={(e) => set("mountingType", e.target.value)} className={inputCls}>
                    {MOUNTINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Year of manufacture" hint="Estimated. Leave blank if unknown." error={fields.yearOfManufacture}>
                  <input
                    value={form.yearOfManufacture}
                    onChange={(e) => set("yearOfManufacture", e.target.value)}
                    inputMode="numeric"
                    placeholder="Unknown"
                    className={inputCls}
                  />
                </Field>
                <Field label="Feeder" hint="If known.">
                  <input value={form.feeder} onChange={(e) => set("feeder", e.target.value)} placeholder="KBT-11kV-04" className={inputCls} />
                </Field>
              </div>

              <Field label="Data source">
                <select value={form.dataSource} onChange={(e) => set("dataSource", e.target.value)} className={inputCls}>
                  {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              {source && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] font-bold text-amber-900">{source.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">{source.accuracy}</p>
                </div>
              )}

              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={3}
                  placeholder={autoNotes}
                  className={inputCls}
                />
              </Field>

              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                This unit is recorded as <strong className="text-navy">already in the field</strong> with no warranty
                claimed — we do not know when KPLC took delivery. A field engineer&apos;s first inspection sets the
                health baseline and turns its map pin green.
              </p>
            </div>

            <div className="border-t border-line bg-white p-4">
              <button
                type="submit"
                disabled={saving || !pin}
                className="w-full rounded-xl bg-kplc px-5 py-4 text-base font-bold text-white transition hover:bg-kplc-dark disabled:opacity-40"
              >
                {saving ? "Onboarding…" : pin ? "Onboard transformer" : "Place a pin to continue"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-kplc";

function Field({
  label, hint, error, children,
}: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-navy">{label}</span>
      {hint && <span className="ml-1.5 text-[11px] text-ink-soft">{hint}</span>}
      <div className="mt-1">{children}</div>
      {error && <span className="mt-1 block text-[11px] font-semibold text-red-700">{error}</span>}
    </label>
  );
}
