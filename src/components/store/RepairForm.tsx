"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { assessRepairCost } from "@/lib/repair-economics";

/**
 * The workshop outcome form.
 *
 * The cost comparison updates live rather than after submission, because the
 * decision it informs — repair or condemn — is being made while the technician
 * is standing at the bench with the unit open. Telling them afterwards that the
 * repair was uneconomic is telling them too late.
 */

const FAULT_CAUSES = [
  "Winding failure — short circuit",
  "Winding failure — open circuit",
  "Insulation breakdown",
  "Oil contamination",
  "Oil loss / leaking gasket",
  "Bushing failure",
  "Tap changer fault",
  "Core fault",
  "Lightning / surge damage",
  "Overheating from sustained overload",
  "Vandalism / theft damage",
  "Other",
];

export function RepairForm({
  repairId,
  transformer,
}: {
  repairId: string;
  transformer: {
    id: string;
    label: string;
    ratingKva: number;
    make: string;
    siteName: string | null;
    repairCount: number;
    reportedFault: string | null;
    daysOnBench: number;
  };
}) {
  const router = useRouter();
  const [f, setF] = useState<Record<string, string>>({ repairWarrantyMonths: "3" });
  const [successful, setSuccessful] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: string; turnaroundDays: number | null;
    economicWarning: string | null; repeatWarning: string | null;
    stock: { total: number; availableInStore: number; repairedAvailable: number } | null;
    supplyRequestId: string | null; alertsRaised: number;
  } | null>(null);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const economics = useMemo(() => {
    const cost = Number(f.repairCostKes);
    if (!Number.isFinite(cost) || cost <= 0) return null;
    return assessRepairCost(cost, transformer.ratingKva);
  }, [f.repairCostKes, transformer.ratingKva]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (successful === null) { setError("Say whether the repair worked. That is the whole point of this form."); return; }
    if (!f.faultCauseConfirmed) { setError("State what the workshop actually found."); return; }
    if (!successful && (!f.failureReason || f.failureReason.trim().length < 4)) {
      setError("A condemned transformer needs a reason. Somebody will ask why it was scrapped.");
      return;
    }

    setSaving(true); setError(null);
    const res = await fetch("/api/workshop/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repairId,
        faultCauseConfirmed: f.faultCauseConfirmed === "Other" ? (f.faultCauseOther || "Other") : f.faultCauseConfirmed,
        repairActions: f.repairActions || undefined,
        partsReplaced: f.partsReplaced || undefined,
        repairCostKes: f.repairCostKes ? Number(f.repairCostKes) : undefined,
        repairWarrantyMonths: f.repairWarrantyMonths ? Number(f.repairWarrantyMonths) : undefined,
        workshopTechnician: f.workshopTechnician || undefined,
        notes: f.notes || undefined,
        successful,
        failureReason: successful ? undefined : f.failureReason,
        test: successful
          ? {
              oilBdvKv: f.oilBdvKv ? Number(f.oilBdvKv) : undefined,
              insulationResistanceHvMohm: f.irHv ? Number(f.irHv) : undefined,
              insulationResistanceLvMohm: f.irLv ? Number(f.irLv) : undefined,
              turnsRatioDeviationPct: f.ratioDev ? Number(f.ratioDev) : undefined,
              passed: true,
              remarks: "Post-repair verification",
            }
          : undefined,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(d.error ?? "That did not save."); return; }
    setResult(d);
    router.refresh();
  }

  // --- Outcome ------------------------------------------------------------
  if (result) {
    const failed = result.status === "BEYOND_REPAIR";
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl border-2 p-6 ${failed ? "border-red-300 bg-red-50" : "border-kplc/30 bg-kplc/5"}`}>
          <p className="text-4xl">{failed ? "⚠️" : "✅"}</p>
          <p className="mt-3 text-lg font-extrabold text-navy">
            {failed ? "Condemned beyond repair" : "Repair recorded"}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {transformer.label} · {result.turnaroundDays} day(s) on the bench ·{" "}
            {result.alertsRaised} alert{result.alertsRaised === 1 ? "" : "s"} raised
          </p>

          {!failed && (
            <p className="mt-4 rounded-lg bg-white px-4 py-3 text-sm text-navy">
              Next step: book it back into a store, and it is available for dispatch again.
            </p>
          )}

          {failed && result.stock && (
            <div className="mt-4 rounded-lg bg-white px-4 py-3">
              <p className="text-xs font-bold tracking-wide text-ink-soft">REPLACEMENT STOCK CHECKED</p>
              {result.stock.total > 0 ? (
                <p className="mt-1 text-sm font-bold text-kplc">
                  {result.stock.total} × {transformer.ratingKva} kVA available
                  <span className="font-normal text-ink-soft">
                    {" "}({result.stock.availableInStore} in store, {result.stock.repairedAvailable} repaired)
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-sm font-bold text-red-700">
                  No free {transformer.ratingKva} kVA unit. Procurement required —
                  the site stays off supply until one arrives.
                </p>
              )}
              {result.supplyRequestId && (
                <p className="mt-1.5 text-xs text-ink-soft">
                  A supply request has been raised automatically for this site.
                </p>
              )}
            </div>
          )}

          {result.economicWarning && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {result.economicWarning}
            </p>
          )}
          {result.repeatWarning && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              {result.repeatWarning}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/store/workshop" className="rounded-xl bg-kplc px-5 py-3 text-sm font-bold text-white">
            Back to workshop
          </Link>
          <Link href={`/transformers/${transformer.id}`} className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy">
            View full story
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* --- Context ------------------------------------------------------- */}
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="text-sm font-bold text-navy">{transformer.label}</p>
        <p className="text-xs text-ink-soft">
          {transformer.make} · {transformer.ratingKva} kVA
          {transformer.siteName ? ` · from ${transformer.siteName}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <span className="text-ink-soft">
            <strong className="text-navy">{transformer.daysOnBench}</strong> days on the bench
          </span>
          {transformer.reportedFault && (
            <span className="text-ink-soft">
              Reported: <strong className="text-navy">{transformer.reportedFault}</strong>
            </span>
          )}
          {transformer.repairCount >= 2 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-900">
              ⚠ visit {transformer.repairCount + 1}
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}

      {/* --- Diagnosis ------------------------------------------------------ */}
      <Section
        title="What the workshop found"
        note="Frequently not what the field reported. A unit sent in for an oil leak that turns out to have a shorted winding is the most useful correction in the whole loop — it tells the fleet what is really killing transformers."
      >
        <div className="col-span-2">
          <select value={f.faultCauseConfirmed ?? ""} onChange={(e) => set("faultCauseConfirmed", e.target.value)} className={INPUT}>
            <option value="">Select the confirmed cause…</option>
            {FAULT_CAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {f.faultCauseConfirmed === "Other" && (
          <div className="col-span-2">
            <input value={f.faultCauseOther ?? ""} onChange={(e) => set("faultCauseOther", e.target.value)} placeholder="Describe the cause" className={INPUT} />
          </div>
        )}
      </Section>

      <Section title="Work done">
        <div className="col-span-2">
          <Field label="Repair actions taken">
            <textarea value={f.repairActions ?? ""} onChange={(e) => set("repairActions", e.target.value)} rows={3} className={INPUT} placeholder="Rewound LV, replaced gaskets, filtered and topped up oil…" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Parts replaced">
            <textarea value={f.partsReplaced ?? ""} onChange={(e) => set("partsReplaced", e.target.value)} rows={2} className={INPUT} placeholder="LV bushings ×3, tank gasket, 120 L oil" />
          </Field>
        </div>
        <Field label="Repair cost (KES)">
          <input inputMode="numeric" value={f.repairCostKes ?? ""} onChange={(e) => set("repairCostKes", e.target.value)} className={INPUT} placeholder="45000" />
        </Field>
        <Field label="Workshop warranty (months)">
          <input inputMode="numeric" value={f.repairWarrantyMonths ?? ""} onChange={(e) => set("repairWarrantyMonths", e.target.value)} className={INPUT} />
        </Field>
        <div className="col-span-2">
          <Field label="Technician">
            <input value={f.workshopTechnician ?? ""} onChange={(e) => set("workshopTechnician", e.target.value)} className={INPUT} placeholder="Who did the work" />
          </Field>
        </div>

        {economics && (
          <div className={`col-span-2 rounded-lg border px-4 py-3 ${economics.uneconomic ? "border-amber-200 bg-amber-50" : "border-line bg-surface-2"}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-soft">Against a new {transformer.ratingKva} kVA</span>
              <span className={`text-xl font-extrabold ${economics.uneconomic ? "text-amber-700" : "text-kplc"}`}>
                {Math.round(economics.ratio * 100)}%
              </span>
            </div>
            <p className={`mt-1 text-[11px] leading-relaxed ${economics.uneconomic ? "text-amber-900" : "text-ink-soft"}`}>
              {economics.message}
            </p>
            <p className="mt-1 text-[10px] text-ink-soft">
              Replacement price is indicative, not a quotation.
            </p>
          </div>
        )}
      </Section>

      {/* --- Outcome -------------------------------------------------------- */}
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="text-xs font-bold tracking-wide text-navy">DID THE REPAIR WORK?</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSuccessful(true)}
            className={`rounded-xl px-4 py-4 text-sm font-bold transition ${successful === true ? "bg-kplc text-white" : "border border-line bg-white text-navy hover:border-kplc"}`}
          >
            ✅ Repaired
          </button>
          <button
            type="button"
            onClick={() => setSuccessful(false)}
            className={`rounded-xl px-4 py-4 text-sm font-bold transition ${successful === false ? "bg-red-600 text-white" : "border border-line bg-white text-navy hover:border-red-400"}`}
          >
            ⚠️ Beyond repair
          </button>
        </div>

        {successful === false && (
          <div className="mt-4">
            <Field label="Why it cannot be repaired" required>
              <textarea
                value={f.failureReason ?? ""}
                onChange={(e) => set("failureReason", e.target.value)}
                rows={2}
                className={INPUT}
                placeholder="Winding damage too extensive to rewind economically"
              />
            </Field>
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-900">
              Condemning this unit leaves its site without supply. On submit the system checks the
              store for a replacement of the same rating, raises a supply request for the site, and
              flags it as CRITICAL if nothing is free.
            </p>
          </div>
        )}

        {successful === true && (
          <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
            <p className="text-[11px] font-bold text-navy">POST-REPAIR TEST</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-soft">
              Required. A repair without a test is a repair nobody can stand behind, and the system
              will not accept one.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Oil BDV (kV)">
                <input inputMode="decimal" value={f.oilBdvKv ?? ""} onChange={(e) => set("oilBdvKv", e.target.value)} className={INPUT} placeholder="45" />
              </Field>
              <Field label="Ratio deviation (%)">
                <input inputMode="decimal" value={f.ratioDev ?? ""} onChange={(e) => set("ratioDev", e.target.value)} className={INPUT} placeholder="0.2" />
              </Field>
              <Field label="IR HV (MΩ)">
                <input inputMode="decimal" value={f.irHv ?? ""} onChange={(e) => set("irHv", e.target.value)} className={INPUT} placeholder="600" />
              </Field>
              <Field label="IR LV (MΩ)">
                <input inputMode="decimal" value={f.irLv ?? ""} onChange={(e) => set("irLv", e.target.value)} className={INPUT} placeholder="450" />
              </Field>
            </div>
          </div>
        )}

        {successful === true && (
          <p className="mt-3 rounded-lg bg-kplc/5 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
            The unit becomes <strong className="text-navy">REPAIRED</strong> and can be booked back
            into a store for dispatch. Its workshop warranty starts today — if it fails inside that
            window the rework is the workshop&apos;s, not the manufacturer&apos;s.
          </p>
        )}
      </div>

      <Section title="Notes">
        <div className="col-span-2">
          <textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={2} className={INPUT} placeholder="Anything the fields above do not capture." />
        </div>
      </Section>

      <button
        type="submit"
        disabled={saving || successful === null}
        className="w-full rounded-xl bg-kplc px-5 py-4 text-base font-bold text-white hover:bg-kplc-dark disabled:opacity-40"
      >
        {saving ? "Recording…" : successful === false ? "Condemn transformer" : "Record repair"}
      </button>
    </form>
  );
}

const INPUT = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-kplc";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-bold tracking-wide text-navy">{title.toUpperCase()}</p>
      {note && <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{note}</p>}
      <div className="mt-3 grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-navy">
        {label}{required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
