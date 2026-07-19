"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Insulation and winding resistance, captured at the pole.
 *
 * Mobile-first and deliberately blunt: the corrected figure and the verdict
 * update as the engineer types, so a bad reading is obvious while they are
 * still standing under the transformer and can repeat it — not three days later
 * when the report is opened.
 */

const VOLTAGES = [500, 1000, 2500, 5000];

export function ElectricalTestForm({
  transformerId,
  label,
  ratingKva,
}: {
  transformerId: string;
  label: string;
  ratingKva: number;
}) {
  const router = useRouter();
  const [f, setF] = useState<Record<string, string>>({
    irTestVoltageV: "5000",
    irDurationSec: "60",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ passed: boolean; findings: string[]; irCorrectedTo20C: number | null; polarizationIndex: number | null; wrDeviationPct: number | null } | null>(null);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const num = (k: string) => { const n = Number(f[k]); return Number.isFinite(n) && f[k] !== "" ? n : null; };

  // --- Live preview of the derived values ---------------------------------
  const live = useMemo(() => {
    const irs = [num("irHvEarthMohm"), num("irLvEarthMohm"), num("irHvLvMohm")].filter((v): v is number => v != null);
    const lowest = irs.length ? Math.min(...irs) : null;
    const t = num("windingTempC");
    // IR halves per 10 C rise: R20 = Rt x 2^((t-20)/10)
    const corrected = lowest != null && t != null ? lowest * Math.pow(2, (t - 20) / 10) : null;

    const one = num("irOneMinuteMohm"), ten = num("irTenMinuteMohm");
    const pi = one && ten && one > 0 ? ten / one : null;

    const dev = (vals: (number | null)[]) => {
      const v = vals.filter((x): x is number => x != null && x > 0);
      if (v.length < 2) return null;
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      return (Math.max(...v.map((x) => Math.abs(x - mean))) / mean) * 100;
    };
    const hv = dev([num("wrHvL1"), num("wrHvL2"), num("wrHvL3")]);
    const lv = dev([num("wrLvL1"), num("wrLvL2"), num("wrLvL3")]);
    const worst = [hv, lv].filter((x): x is number => x != null).sort((a, b) => b - a)[0] ?? null;

    return { lowest, corrected, pi, hv, lv, worst };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);

  const irVerdict =
    live.corrected == null ? null
    : live.corrected < 1 ? { tone: "bad", text: "BELOW 1 MΩ — DO NOT ENERGISE" }
    : live.corrected < 50 ? { tone: "bad", text: "Below the 50 MΩ action level" }
    : live.corrected < 100 ? { tone: "warn", text: "Below the 100 MΩ watch level" }
    : { tone: "good", text: "Acceptable" };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (num("windingTempC") == null) { setError("Winding temperature is required — insulation resistance cannot be compared without it."); return; }
    setSaving(true); setError(null);

    const body: Record<string, unknown> = {};
    for (const k of Object.keys(f)) { const n = Number(f[k]); if (f[k] !== "" && Number.isFinite(n)) body[k] = n; }
    if (f.remarks) body.remarks = f.remarks;

    const res = await fetch(`/api/transformers/${transformerId}/electrical`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setError(d.error ?? "That did not save."); return; }
    setResult(d);
    router.refresh();
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className={`rounded-2xl border-2 p-6 text-center ${result.passed ? "border-kplc/30 bg-kplc/5" : "border-red-300 bg-red-50"}`}>
          <p className="text-4xl">{result.passed ? "✅" : "⚠️"}</p>
          <p className="mt-3 text-lg font-extrabold text-navy">{result.passed ? "Test recorded — passed" : "Test recorded — FAILED"}</p>
          <dl className="mt-4 space-y-1 text-sm">
            {result.irCorrectedTo20C != null && (
              <div className="flex justify-between"><dt className="text-ink-soft">IR at 20 °C</dt><dd className="font-bold text-navy">{result.irCorrectedTo20C.toFixed(result.irCorrectedTo20C < 10 ? 2 : 0)} MΩ</dd></div>
            )}
            {result.polarizationIndex != null && (
              <div className="flex justify-between"><dt className="text-ink-soft">Polarization index</dt><dd className="font-bold text-navy">{result.polarizationIndex.toFixed(2)}</dd></div>
            )}
            {result.wrDeviationPct != null && (
              <div className="flex justify-between"><dt className="text-ink-soft">Winding spread</dt><dd className="font-bold text-navy">{result.wrDeviationPct.toFixed(1)}%</dd></div>
            )}
          </dl>
          {result.findings.length > 0 && (
            <ul className="mt-4 space-y-1 text-left text-xs text-red-800">
              {result.findings.map((x, i) => <li key={i}>• {x}</li>)}
            </ul>
          )}
        </div>
        <button onClick={() => { setResult(null); setF({ irTestVoltageV: "5000", irDurationSec: "60" }); }}
          className="w-full rounded-xl border border-line bg-white px-5 py-3 text-sm font-bold text-navy">
          Record another test
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-xl border border-line bg-white p-4">
        <p className="text-sm font-bold text-navy">{label}</p>
        <p className="text-xs text-ink-soft">{ratingKva} kVA · insulation and winding resistance</p>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</p>}

      {/* --- Conditions ---------------------------------------------------- */}
      <Section title="Test conditions" note="Without these, the readings cannot be compared to anything — including their own history.">
        <Field label="Winding temperature (°C)" required>
          <input inputMode="decimal" value={f.windingTempC ?? ""} onChange={(e) => set("windingTempC", e.target.value)} className={INPUT} placeholder="e.g. 42" required />
        </Field>
        <Field label="Ambient (°C)">
          <input inputMode="decimal" value={f.ambientTempC ?? ""} onChange={(e) => set("ambientTempC", e.target.value)} className={INPUT} />
        </Field>
        <Field label="Test voltage">
          <div className="grid grid-cols-4 gap-1.5">
            {VOLTAGES.map((v) => (
              <button key={v} type="button" onClick={() => set("irTestVoltageV", String(v))}
                className={`rounded-lg px-2 py-2 text-xs font-bold ${f.irTestVoltageV === String(v) ? "bg-navy text-white" : "border border-line bg-white text-ink-soft"}`}>
                {v >= 1000 ? `${v / 1000} kV` : `${v} V`}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Duration">
          <div className="grid grid-cols-2 gap-1.5">
            {[["60", "60 s"], ["600", "10 min"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => set("irDurationSec", v)}
                className={`rounded-lg px-2 py-2 text-xs font-bold ${f.irDurationSec === v ? "bg-navy text-white" : "border border-line bg-white text-ink-soft"}`}>
                {l}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      {/* --- IR ------------------------------------------------------------- */}
      <Section title="Insulation resistance (MΩ)">
        <Field label="HV to earth"><input inputMode="decimal" value={f.irHvEarthMohm ?? ""} onChange={(e) => set("irHvEarthMohm", e.target.value)} className={INPUT} /></Field>
        <Field label="LV to earth"><input inputMode="decimal" value={f.irLvEarthMohm ?? ""} onChange={(e) => set("irLvEarthMohm", e.target.value)} className={INPUT} /></Field>
        <Field label="HV to LV"><input inputMode="decimal" value={f.irHvLvMohm ?? ""} onChange={(e) => set("irHvLvMohm", e.target.value)} className={INPUT} /></Field>

        {live.corrected != null && irVerdict && (
          <div className={`col-span-2 rounded-lg px-4 py-3 ${irVerdict.tone === "bad" ? "bg-red-50 border border-red-200" : irVerdict.tone === "warn" ? "bg-amber-50 border border-amber-200" : "bg-kplc/5 border border-kplc/20"}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ink-soft">Corrected to 20 °C</span>
              <span className={`text-2xl font-extrabold ${irVerdict.tone === "bad" ? "text-red-700" : irVerdict.tone === "warn" ? "text-amber-700" : "text-kplc"}`}>
                {live.corrected.toFixed(live.corrected < 10 ? 2 : 0)} MΩ
              </span>
            </div>
            <p className={`mt-1 text-xs font-bold ${irVerdict.tone === "bad" ? "text-red-800" : irVerdict.tone === "warn" ? "text-amber-800" : "text-kplc"}`}>
              {irVerdict.text}
            </p>
            <p className="mt-1 text-[11px] text-ink-soft">
              Measured {live.lowest?.toFixed(1)} MΩ at {f.windingTempC} °C. IR halves per 10 °C rise,
              so the corrected figure is the one that can be trended.
            </p>
          </div>
        )}
      </Section>

      {/* --- PI -------------------------------------------------------------- */}
      <Section title="Polarization index" note="IR at 10 minutes ÷ IR at 1 minute. Under 1.0 the insulation is taking up moisture — it catches problems a single healthy-looking figure hides.">
        <Field label="IR at 1 min (MΩ)"><input inputMode="decimal" value={f.irOneMinuteMohm ?? ""} onChange={(e) => set("irOneMinuteMohm", e.target.value)} className={INPUT} /></Field>
        <Field label="IR at 10 min (MΩ)"><input inputMode="decimal" value={f.irTenMinuteMohm ?? ""} onChange={(e) => set("irTenMinuteMohm", e.target.value)} className={INPUT} /></Field>
        {live.pi != null && (
          <div className="col-span-2 flex items-baseline justify-between rounded-lg bg-surface-2 px-4 py-2">
            <span className="text-xs text-ink-soft">Polarization index</span>
            <span className={`text-lg font-extrabold ${live.pi < 1 ? "text-red-700" : live.pi < 2 ? "text-amber-700" : "text-kplc"}`}>
              {live.pi.toFixed(2)}
            </span>
          </div>
        )}
      </Section>

      {/* --- WR -------------------------------------------------------------- */}
      <Section title="Winding resistance (Ω)" note="Judged by the spread between phases, not the absolute value. Over 2% suggests a loose connection; over 5% a damaged winding.">
        <Field label="HV L1"><input inputMode="decimal" value={f.wrHvL1 ?? ""} onChange={(e) => set("wrHvL1", e.target.value)} className={INPUT} /></Field>
        <Field label="HV L2"><input inputMode="decimal" value={f.wrHvL2 ?? ""} onChange={(e) => set("wrHvL2", e.target.value)} className={INPUT} /></Field>
        <Field label="HV L3"><input inputMode="decimal" value={f.wrHvL3 ?? ""} onChange={(e) => set("wrHvL3", e.target.value)} className={INPUT} /></Field>
        <Field label="LV L1"><input inputMode="decimal" value={f.wrLvL1 ?? ""} onChange={(e) => set("wrLvL1", e.target.value)} className={INPUT} /></Field>
        <Field label="LV L2"><input inputMode="decimal" value={f.wrLvL2 ?? ""} onChange={(e) => set("wrLvL2", e.target.value)} className={INPUT} /></Field>
        <Field label="LV L3"><input inputMode="decimal" value={f.wrLvL3 ?? ""} onChange={(e) => set("wrLvL3", e.target.value)} className={INPUT} /></Field>
        {live.worst != null && (
          <div className="col-span-2 flex items-baseline justify-between rounded-lg bg-surface-2 px-4 py-2">
            <span className="text-xs text-ink-soft">Worst phase spread</span>
            <span className={`text-lg font-extrabold ${live.worst > 5 ? "text-red-700" : live.worst > 2 ? "text-amber-700" : "text-kplc"}`}>
              {live.worst.toFixed(1)}%
            </span>
          </div>
        )}
      </Section>

      <Section title="Remarks">
        <div className="col-span-2">
          <textarea value={f.remarks ?? ""} onChange={(e) => set("remarks", e.target.value)} rows={3} className={INPUT} placeholder="Anything the numbers do not say." />
        </div>
      </Section>

      <button type="submit" disabled={saving}
        className="w-full rounded-xl bg-kplc px-5 py-4 text-base font-bold text-white hover:bg-kplc-dark disabled:opacity-50">
        {saving ? "Saving…" : "Record test"}
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
