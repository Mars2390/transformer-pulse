import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { analyseDatasetById, ASSUMED_AMBIENT_C } from "@/lib/emdis-read";
import { PhaseBars } from "@/components/control/PhaseBars";
import { LIMITS } from "@/lib/load-analysis";
import { LoadAnalysisActions } from "@/components/control/LoadAnalysisActions";

export const metadata: Metadata = { title: "Load analysis" };
export const dynamic = "force-dynamic";

export default async function LoadAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  const full = await analyseDatasetById(id);
  if (!full) notFound();

  const { dataset, transformer, inspection, analysis: a, thermalByKva, thermalByPhase } = full;
  const label = transformer?.gNumber ?? dataset.substationCode ?? dataset.name;

  const critical = a.findings.filter((f) => f.severity === "CRITICAL");
  const warnings = a.findings.filter((f) => f.severity === "WARNING");

  const hrs = (m: number) => (m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(0)} min`);

  return (
    <div className="space-y-6">
      {/* --- Header --------------------------------------------------------- */}
      <div>
        <Link href="/manager/emdis" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Load data
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-navy">
              {transformer?.gNumber ? `G-${transformer.gNumber}` : label}
              <span className="ml-3 text-base font-bold text-ink-soft">
                {transformer?.ratingKva ?? "?"} kVA
              </span>
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              Substation {dataset.substationCode}
              {transformer?.substationName ? ` — ${transformer.substationName}` : ""}
              {transformer?.manufacturer ? ` · ${transformer.manufacturer}` : ""}
              {inspection?.locationNote ? ` · ${inspection.locationNote}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <span
              className={`rounded-lg px-3 py-2 text-xs font-extrabold ${
                a.severity === "CRITICAL"
                  ? "bg-red-100 text-red-800"
                  : a.severity === "WARNING"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-kplc/10 text-kplc"
              }`}
            >
              {a.severity}
            </span>
            {transformer && (
              <Link
                href={`/transformers/${transformer.id}`}
                className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy hover:border-kplc"
              >
                Full record
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* --- THE CONTRADICTION ---------------------------------------------- */}
      {a.hiddenOverloadMinutes > 0 && (
        <div className="overflow-hidden rounded-2xl border-2 border-red-300 bg-red-50">
          <div className="border-b border-red-200 bg-red-100 px-5 py-2.5">
            <p className="text-[11px] font-extrabold tracking-[0.12em] text-red-900">
              WHAT THE kVA FIGURE HIDES
            </p>
          </div>
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-bold tracking-wide text-ink-soft">TOTAL LOAD, IN kVA</p>
              <p className="mt-1 text-4xl font-extrabold text-kplc">
                {a.peakLoadingPct.toFixed(0)}%
              </p>
              <p className="text-xs text-ink-soft">
                peak {a.peakKva.toFixed(0)} kVA of {a.ratingKva} — never exceeded the nameplate
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold tracking-wide text-ink-soft">HOTTEST SINGLE PHASE</p>
              <p className="mt-1 text-4xl font-extrabold text-red-700">
                {a.peakPhasePctRated.toFixed(0)}%
              </p>
              <p className="text-xs text-ink-soft">
                peak {a.peakPhaseA.toFixed(0)} A against a rated {a.ratedPhaseA.toFixed(0)} A
              </p>
            </div>
          </div>
          <p className="border-t border-red-200 bg-white/60 px-5 py-3 text-sm font-semibold leading-relaxed text-red-900">
            A phase ran above its rating for {hrs(a.minutesAnyPhaseOverRated)} — and for{" "}
            {hrs(a.hiddenOverloadMinutes)} of that the total kVA was still inside the nameplate.
            No kVA-based report would have shown any of it.
          </p>
        </div>
      )}

      {/* --- Per-phase ------------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-navy p-5 text-white lg:col-span-2">
          <p className="text-[11px] font-bold tracking-[0.1em] text-white/60">
            PEAK CURRENT PER PHASE · RATED {a.ratedPhaseA.toFixed(0)} A
          </p>
          <div className="mt-4">
            <PhaseBars
              phases={a.perPhase.map((p) => ({ name: p.name, amps: p.peakA, pctRated: p.peakPctRated }))}
              ratedA={a.ratedPhaseA}
              fuseA={inspection?.fuseSizeA}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-xs">
            {a.perPhase.map((p) => (
              <div key={p.name}>
                <p className="text-white/50">{p.name} over rated</p>
                <p className="font-bold">{p.minutesOverRated > 0 ? hrs(p.minutesOverRated) : "never"}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[11px] font-bold tracking-[0.1em] text-ink-soft">BALANCE</p>
          <Metric
            label="Current unbalance"
            value={`${a.unbalance.median.toFixed(0)}%`}
            sub={`p95 ${a.unbalance.p95.toFixed(0)}% · max ${a.unbalance.max.toFixed(0)}%`}
            bad={a.unbalance.median >= LIMITS.unbalanceCritical}
            warn={a.unbalance.median >= LIMITS.unbalanceWarn}
            note={`limit ${LIMITS.unbalanceWarn}%`}
          />
          <Metric
            label="Neutral current"
            value={`${a.neutral.medianPctRated.toFixed(0)}%`}
            sub={`${a.neutral.medianA.toFixed(0)} A median · peak ${a.neutral.maxPctRated.toFixed(0)}%`}
            bad={a.neutral.medianPctRated >= LIMITS.neutralCritical * 100}
            warn={a.neutral.medianPctRated >= LIMITS.neutralWarn * 100}
            note="balanced load carries none"
          />
          <Metric
            label="Extra copper loss"
            value={`+${((a.meanUnbalanceLossFactor - 1) * 100).toFixed(1)}%`}
            sub="caused by the imbalance alone"
            warn={a.meanUnbalanceLossFactor > 1.05}
            note="loss follows I²"
          />
        </div>
      </div>

      {/* --- Thermal --------------------------------------------------------- */}
      <div className="rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">
            Thermal — IEC 60076-7, ambient {ASSUMED_AMBIENT_C} °C
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            The hot-spot sits in the winding carrying the most current, not in an average.
            These two columns are the same transformer over the same four days.
          </p>
        </div>
        <div className="grid gap-px bg-line sm:grid-cols-2">
          <ThermalCol
            title="If you judge by total kVA"
            subtitle="what a conventional report concludes"
            t={thermalByKva}
            tone="calm"
          />
          <ThermalCol
            title="Judged by the hottest winding"
            subtitle="what the insulation actually experiences"
            t={thermalByPhase}
            tone="alarm"
          />
        </div>
        {thermalByPhase.ageingRate > thermalByKva.ageingRate * 2 && (
          <p className="border-t border-line bg-red-50 px-5 py-3 text-sm font-semibold text-red-900">
            {(thermalByPhase.hotspotC - thermalByKva.hotspotC).toFixed(0)} °C hotter, and ageing{" "}
            {(thermalByPhase.ageingRate / Math.max(0.01, thermalByKva.ageingRate)).toFixed(0)}× faster
            than the kVA view predicts.
          </p>
        )}
      </div>

      {/* --- The inspector -------------------------------------------------- */}
      {inspection && (
        <div className="rounded-2xl border border-line bg-white p-5">
          <p className="text-[11px] font-bold tracking-[0.1em] text-ink-soft">
            WHAT THE INSPECTOR RECORDED
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm text-ink-soft">
                {inspection.inspectorRef} inspected this transformer on{" "}
                <strong className="text-navy">
                  {inspection.inspectedOn.toISOString().slice(0, 10)}
                </strong>
                , {daysBetween(inspection.inspectedOn, dataset.firstReadingAt)} days before this load
                data begins.
              </p>
              {inspection.loadingOk === false && (
                <p className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm">
                  <span className="font-bold text-red-900">
                    Loading recorded as NOT OKAY
                    {inspection.loadAction ? ` · action: ${inspection.loadAction.replace(/_/g, " ")}` : ""}
                  </span>
                  <span className="mt-1 block text-red-800">
                    He judged it by eye. The meters agree with him.
                  </span>
                </p>
              )}
              {inspection.loadingOk === true && (
                <p className="mt-3 text-sm text-ink-soft">
                  Loading recorded as okay at the time of inspection.
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs sm:grid-cols-1">
              <Detail k="Fuse size" v={inspection.fuseSizeA ? `${inspection.fuseSizeA} A` : "—"} />
              <Detail k="Structure" v={inspection.structure ?? "—"} />
              <Detail
                k="HV earth"
                v={
                  inspection.hvEarthState === "OPEN_CIRCUIT"
                    ? "OPEN"
                    : inspection.hvEarthOhm != null
                      ? `${inspection.hvEarthOhm} Ω`
                      : "not measured"
                }
              />
            </dl>
          </div>
        </div>
      )}

      {/* --- Findings -------------------------------------------------------- */}
      <div className="rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">
            Findings — {critical.length} critical, {warnings.length} warning
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">Raised automatically from the measurements.</p>
        </div>
        <ul className="divide-y divide-line">
          {a.findings.map((f, i) => (
            <li key={i} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                    f.severity === "CRITICAL"
                      ? "bg-red-100 text-red-800"
                      : f.severity === "WARNING"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-kplc/10 text-kplc"
                  }`}
                >
                  {f.severity}
                </span>
                <p className="text-sm font-bold text-navy">{f.headline}</p>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{f.detail}</p>
              <p className="mt-1.5 text-[13px] font-semibold text-navy">→ {f.action}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* --- Actions --------------------------------------------------------- */}
      <LoadAnalysisActions
        datasetId={dataset.id}
        transformerId={transformer?.id ?? null}
        gNumber={transformer?.gNumber ?? null}
        siteName={transformer?.siteName ?? inspection?.locationNote ?? null}
        substationCode={dataset.substationCode}
        region={transformer?.region ?? null}
        ratingKva={a.ratingKva}
        peakPhasePct={a.peakPhasePctRated}
        unbalancePct={a.unbalance.median}
        severity={a.severity}
      />

      {/* --- Load curve ------------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-navy">Load through the day</h2>
          <p className="text-xs text-ink-soft">
            load factor {a.loadFactorPct?.toFixed(0)}% · {a.energyKwh?.toFixed(0)} kWh over{" "}
            {a.spanHours.toFixed(0)} h
          </p>
        </div>
        <div className="mt-4 flex h-40 items-end gap-[3px]">
          {a.hourly.map((h) => {
            const max = Math.max(...a.hourly.map((x) => x.meanKva), 1);
            const pct = (h.meanKva / max) * 100;
            const over = (h.maxPhaseA / a.ratedPhaseA) * 100;
            return (
              <div key={h.hour} className="group relative flex-1" title={`${h.hour}:00 — ${h.meanKva.toFixed(0)} kVA, peak phase ${over.toFixed(0)}%`}>
                <div
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${Math.max(2, pct * 1.4)}px`,
                    backgroundColor: over >= 100 ? "#dc2626" : over >= 80 ? "#d97706" : "#0e8a4f",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-soft">
          <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
        </div>
        <p className="mt-2 text-[11px] text-ink-soft">
          Bar colour is the peak single-phase loading in that hour, not the kVA — green under 80%,
          amber to 100%, red above.
        </p>
      </div>

      {/* --- Provenance ------------------------------------------------------ */}
      <div className="rounded-2xl border border-line bg-surface-2 p-5 text-xs leading-relaxed text-ink-soft">
        <p className="font-bold text-navy">How these numbers were produced</p>
        <p className="mt-2">
          {dataset.readingCount.toLocaleString()} readings at {dataset.intervalSeconds}-second
          intervals from {dataset.firstReadingAt.toISOString().slice(0, 16).replace("T", " ")} to{" "}
          {dataset.lastReadingAt.toISOString().slice(0, 16).replace("T", " ")} UTC, file{" "}
          <span className="font-mono">{dataset.name}</span>.
        </p>
        <p className="mt-2">
          Rated phase current I = S / (√3 × V) = {a.ratingKva} kVA ÷ (√3 × {a.voltLL} V) ={" "}
          {a.ratedPhaseA.toFixed(0)} A. Unbalance is the NEMA definition — maximum deviation from the
          three-phase mean. Thermal figures follow IEC 60076-7 at an assumed {ASSUMED_AMBIENT_C} °C
          ambient; the transformer&apos;s own loss values would sharpen them, and they come from its
          test certificate.
        </p>
      </div>
    </div>
  );
}

function daysBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function Metric({
  label, value, sub, note, bad, warn,
}: { label: string; value: string; sub: string; note?: string; bad?: boolean; warn?: boolean }) {
  return (
    <div className="mt-3 border-t border-line pt-3 first:border-0 first:pt-0">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-ink-soft">{label}</span>
        <span className={`text-lg font-extrabold ${bad ? "text-red-700" : warn ? "text-amber-700" : "text-navy"}`}>
          {value}
        </span>
      </div>
      <p className="text-[11px] text-ink-soft">{sub}</p>
      {note && <p className="text-[10px] text-ink-soft opacity-70">{note}</p>}
    </div>
  );
}

function ThermalCol({
  title, subtitle, t, tone,
}: {
  title: string; subtitle: string; tone: "calm" | "alarm";
  t: { hotspotC: number; topOilC: number; ageingRate: number; band: string; loadingPct: number };
}) {
  const alarm = tone === "alarm";
  return (
    <div className={`p-5 ${alarm ? "bg-red-50/60" : "bg-white"}`}>
      <p className="text-sm font-bold text-navy">{title}</p>
      <p className="text-[11px] text-ink-soft">{subtitle}</p>
      <p className={`mt-3 text-4xl font-extrabold ${alarm ? "text-red-700" : "text-kplc"}`}>
        {t.hotspotC.toFixed(0)} °C
      </p>
      <p className="text-xs text-ink-soft">hot-spot · limit {LIMITS.hotspotC} °C</p>
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between"><dt className="text-ink-soft">Top oil</dt><dd className="font-bold text-navy">{t.topOilC.toFixed(0)} °C</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">Ageing rate</dt><dd className={`font-bold ${alarm ? "text-red-700" : "text-navy"}`}>{t.ageingRate < 10 ? t.ageingRate.toFixed(2) : t.ageingRate.toFixed(0)}×</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">Band</dt><dd className={`font-bold ${alarm ? "text-red-700" : "text-kplc"}`}>{t.band}</dd></div>
      </dl>
      {alarm && t.ageingRate > 2 && (
        <p className="mt-3 text-[11px] font-semibold leading-snug text-red-800">
          One hour at this temperature consumes {t.ageingRate.toFixed(0)} hours of insulation life.
        </p>
      )}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-ink-soft">{k}</dt>
      <dd className="font-bold text-navy">{v}</dd>
    </div>
  );
}
