"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge } from "./Gauge";
import { LoadCurve } from "./LoadCurve";
import { TransformerCutaway } from "./TransformerCutaway";
import { computeThermal, conditionScore, type ThermalResult } from "@/lib/transformer-thermal";

/**
 * The KPLC control room.
 *
 * Replays an uploaded day of meter data: five batches of meters per 15-minute
 * interval, aggregated on the server, accumulated here. The replay is driven by
 * an async loop held in refs rather than React state, because state captured in
 * a closure goes stale the moment the operator changes speed mid-run.
 */

type Dataset = {
  id: string; name: string; transformerRef: string | null; ratingKva: number;
  meterCount: number; intervalCount: number; batchSize: number;
  uploadedByName: string; intervalLabels: string[];
};

type BatchResult = {
  meters: number; live: number; offline: number; activeKw: number; apparentKva: number;
  avgPowerFactor: number; avgVoltage: number; minVoltage: number; maxVoltage: number;
  lowVoltageMeters: number; criticalVoltageMeters: number; currentA: number;
  label: string; empty?: boolean;
};

type Accumulated = {
  meters: number; offline: number; activeKw: number; apparentKva: number;
  voltageSum: number; voltageCount: number; minVoltage: number;
  pfSum: number; pfCount: number; lowVoltageMeters: number; criticalVoltageMeters: number;
};

type ControlAlert = {
  id: string; severity: "CRITICAL" | "WARNING" | "INFO";
  time: string; message: string;
};

const EMPTY: Accumulated = {
  meters: 0, offline: 0, activeKw: 0, apparentKva: 0, voltageSum: 0, voltageCount: 0,
  minVoltage: 0, pfSum: 0, pfCount: 0, lowVoltageMeters: 0, criticalVoltageMeters: 0,
};

const AMBIENT_C = 28; // Nairobi daytime ambient; the thermal model's reference

export function ControlRoom() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [soundOn, setSoundOn] = useState(false);

  const [interval_, setInterval_] = useState(0);
  const [batch, setBatch] = useState(0);
  const [batchTimes, setBatchTimes] = useState<(number | null)[]>([null, null, null, null, null]);
  const [acc, setAcc] = useState<Accumulated>(EMPTY);
  const [curve, setCurve] = useState<{ interval: number; kva: number }[]>([]);
  const [alerts, setAlerts] = useState<ControlAlert[]>([]);
  const [peak, setPeak] = useState<{ kva: number; label: string } | null>(null);
  const [clock, setClock] = useState("");

  const cancelRef = useRef(false);
  const pausedRef = useRef(false);
  const speedRef = useRef(5);
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode; osc: OscillatorNode[] } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Live wall clock.
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB"));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/control/dataset")
      .then((r) => r.json())
      .then((d) => setDataset(d.dataset))
      .finally(() => setLoading(false));
  }, []);

  const avgVoltage = acc.voltageCount ? acc.voltageSum / acc.voltageCount : 0;
  const avgPf = acc.pfCount ? acc.pfSum / acc.pfCount : 0.95;
  const rating = dataset?.ratingKva ?? 200;
  const thermal: ThermalResult = computeThermal({
    loadKva: acc.apparentKva, ratingKva: rating, ambientC: AMBIENT_C, powerFactor: avgPf,
  });
  const score = conditionScore(thermal, avgVoltage, acc.minVoltage, avgPf);

  // A transformer hums at TWICE line frequency — magnetostriction stretches the
  // core twice per cycle — so 100 Hz on Kenya's 50 Hz system, not 50.
  const startAudio = useCallback(() => {
    if (audioRef.current) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(ctx.destination);
      const osc = [100, 200, 300].map((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 1 : 0.18 / i;
        o.connect(g); g.connect(gain); o.start();
        return o;
      });
      audioRef.current = { ctx, gain, osc };
    } catch {
      /* Audio is decoration — a blocked context must not stop the demo. */
    }
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.osc.forEach((o) => { try { o.stop(); } catch {} });
    a.ctx.close().catch(() => {});
    audioRef.current = null;
  }, []);

  // Hum tracks load: louder and slightly sharper as the core works harder.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const k = Math.min(1.4, thermal.loadFactor);
    const target = soundOn && running ? 0.012 + k * 0.05 : 0.0001;
    a.gain.gain.setTargetAtTime(target, a.ctx.currentTime, 0.4);
    a.osc[0]?.frequency.setTargetAtTime(100 + k * 4, a.ctx.currentTime, 0.6);
  }, [thermal.loadFactor, soundOn, running]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const evaluate = useCallback((a: Accumulated, label: string, t: ThermalResult) => {
    const found: ControlAlert[] = [];
    const add = (severity: ControlAlert["severity"], message: string) =>
      found.push({ id: `${label}-${message.slice(0, 18)}-${Math.random().toString(36).slice(2, 7)}`, severity, time: label, message });

    const pct = (a.apparentKva / rating) * 100;
    if (pct > 100) add("CRITICAL", `Overload: ${a.apparentKva.toFixed(0)} kVA (${pct.toFixed(1)}% of ${rating} kVA). Hot-spot ${t.hotspotC.toFixed(0)}°C, insulation ageing ${t.ageingRate.toFixed(1)}× normal.`);
    else if (pct > 95) add("WARNING", `Approaching rating: ${pct.toFixed(1)}% loaded. Headroom ${t.headroomKva.toFixed(0)} kVA.`);

    if (t.hotspotC > 120) add("CRITICAL", `Hot-spot ${t.hotspotC.toFixed(0)}°C exceeds the 120°C IEC limit for normal cyclic loading.`);
    else if (t.topOilC > 105) add("CRITICAL", `Top-oil ${t.topOilC.toFixed(0)}°C exceeds the 105°C limit.`);

    const av = a.voltageCount ? a.voltageSum / a.voltageCount : 0;
    if (a.criticalVoltageMeters > 0) add("CRITICAL", `Voltage collapse: ${a.criticalVoltageMeters} meters below 210 V. Lowest ${a.minVoltage.toFixed(0)} V.`);
    else if (av > 0 && av < 220) add("WARNING", `Voltage drop: average ${av.toFixed(0)} V across ${a.voltageCount} meters, ${a.lowVoltageMeters} below 220 V.`);

    if (a.offline > 0) add("WARNING", `${a.offline} meters not reporting.`);

    const pf = a.pfCount ? a.pfSum / a.pfCount : 1;
    if (pf > 0 && pf < 0.85) add("WARNING", `Power factor ${pf.toFixed(2)} — reactive load is consuming ${((1 / pf - 1) * 100).toFixed(0)}% extra capacity.`);

    if (found.length) setAlerts((prev) => [...found, ...prev].slice(0, 40));
  }, [rating]);

  const run = useCallback(async (fromInterval: number) => {
    if (!dataset) return;
    cancelRef.current = false;

    for (let i = fromInterval; i < dataset.intervalCount; i++) {
      setInterval_(i);
      let running_: Accumulated = { ...EMPTY, minVoltage: 0 };
      setAcc(running_);
      setBatchTimes([null, null, null, null, null]);

      for (let b = 0; b < 5; b++) {
        if (cancelRef.current) return;
        while (pausedRef.current) {
          if (cancelRef.current) return;
          await sleep(150);
        }

        setBatch(b);
        const t0 = performance.now();
        const res = await fetch(`/api/control/batch?interval=${i}&batch=${b}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null) as BatchResult | null;

        if (res && !res.empty) {
          running_ = {
            meters: running_.meters + res.meters,
            offline: running_.offline + res.offline,
            activeKw: running_.activeKw + res.activeKw,
            apparentKva: running_.apparentKva + res.apparentKva,
            voltageSum: running_.voltageSum + res.avgVoltage * res.live,
            voltageCount: running_.voltageCount + res.live,
            minVoltage: running_.minVoltage === 0 ? res.minVoltage : Math.min(running_.minVoltage, res.minVoltage || running_.minVoltage),
            pfSum: running_.pfSum + res.avgPowerFactor * res.live,
            pfCount: running_.pfCount + res.live,
            lowVoltageMeters: running_.lowVoltageMeters + res.lowVoltageMeters,
            criticalVoltageMeters: running_.criticalVoltageMeters + res.criticalVoltageMeters,
          };
          setAcc(running_);
        }

        const elapsed = (performance.now() - t0) / 1000;
        setBatchTimes((prev) => { const n = [...prev]; n[b] = elapsed; return n; });

        // 15 s per batch at 1×, scaled by the speed selector.
        const wait = (15_000 / speedRef.current) - (performance.now() - t0);
        if (wait > 0) await sleep(wait);
      }

      // Interval complete — record it and judge it.
      const label = dataset.intervalLabels[i] ?? `#${i}`;
      const finalAcc = running_;
      const t = computeThermal({
        loadKva: finalAcc.apparentKva, ratingKva: rating, ambientC: AMBIENT_C,
        powerFactor: finalAcc.pfCount ? finalAcc.pfSum / finalAcc.pfCount : 0.95,
      });
      setCurve((prev) => [...prev, { interval: i, kva: finalAcc.apparentKva }]);
      setPeak((prev) => (!prev || finalAcc.apparentKva > prev.kva ? { kva: finalAcc.apparentKva, label } : prev));
      evaluate(finalAcc, label, t);
    }

    setRunning(false);
  }, [dataset, rating, evaluate]);

  function start() {
    if (!dataset || running) return;
    setRunning(true);
    setPaused(false);
    if (soundOn) startAudio();
    void run(curve.length);
  }

  function reset() {
    cancelRef.current = true;
    setRunning(false); setPaused(false);
    setInterval_(0); setBatch(0); setAcc(EMPTY);
    setCurve([]); setAlerts([]); setPeak(null);
    setBatchTimes([null, null, null, null, null]);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    if (next) startAudio(); else stopAudio();
  }

  function toggleFullscreen() {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  if (loading) {
    return <div className="grid min-h-svh place-items-center bg-[#0d1b2a] text-slate-400">Loading control centre…</div>;
  }

  if (!dataset) {
    return (
      <div className="grid min-h-svh place-items-center bg-[#0d1b2a] px-6 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-bold text-white">No meter data loaded</h1>
          <p className="mt-2 text-sm text-slate-400">
            Upload a day of smart-meter interval data to run the live monitoring
            demonstration. CSV or Excel, with meterId, timestamp, voltage,
            current, power and powerFactor columns.
          </p>
          <a href="/manager/meter-data" className="mt-5 inline-block rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-[#0d1b2a]">
            Upload meter data
          </a>
        </div>
      </div>
    );
  }

  const bandColour =
    thermal.band === "CRITICAL" ? "text-red-400" : thermal.band === "OVERLOAD" ? "text-orange-400" :
    thermal.band === "WATCH" ? "text-amber-300" : "text-emerald-400";
  const bandDot =
    thermal.band === "CRITICAL" ? "bg-red-500" : thermal.band === "OVERLOAD" ? "bg-orange-500" :
    thermal.band === "WATCH" ? "bg-amber-400" : "bg-emerald-500";

  return (
    <div ref={shellRef} className="min-h-svh bg-[#0d1b2a] pb-28 text-slate-200">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-30 border-b border-[#1e3352] bg-[#0d1b2a]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${bandDot} ${running ? "animate-pulse" : ""}`} />
            <div>
              <h1 className="text-sm font-bold tracking-wide text-white sm:text-base">
                KPLC TRANSFORMER CONTROL CENTRE
              </h1>
              <p className="text-[11px] text-slate-400">
                {dataset.transformerRef ?? dataset.name} · {rating} kVA · {dataset.meterCount} meters
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-mono text-lg font-bold text-white">{clock}</p>
              <p className="text-[11px] text-slate-400">
                Interval {interval_ + 1}/{dataset.intervalCount} · {dataset.intervalLabels[interval_] ?? "--:--"}
              </p>
            </div>
            <button onClick={toggleFullscreen} className="rounded-lg border border-[#2a4468] px-3 py-2 text-[11px] font-bold text-slate-300 hover:bg-[#16243a]">
              Full screen
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6">
        {/* ---- Gauge + cutaway ---- */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr]">
          <Panel title="TRANSFORMER LOADING">
            <div className="h-56"><Gauge valueKva={acc.apparentKva} ratingKva={rating} band={thermal.band} /></div>
            <div className={`mt-1 text-center text-sm font-bold ${bandColour}`}>{thermal.band}</div>
            <p className="mt-1 text-center text-[11px] text-slate-400">
              {acc.activeKw.toFixed(0)} kW active · PF {avgPf.toFixed(2)} · S = P/cos φ
            </p>
          </Panel>

          <Panel title="THERMAL CUTAWAY — IEC 60076-7">
            <div className="h-64"><TransformerCutaway thermal={thermal} ambientC={AMBIENT_C} running={running} /></div>
          </Panel>

          <Panel title="ENGINEERING ANALYSIS">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
              <Metric label="Hot-spot" value={`${thermal.hotspotC.toFixed(1)} °C`} warn={thermal.hotspotC > 110} />
              <Metric label="Top oil" value={`${thermal.topOilC.toFixed(1)} °C`} warn={thermal.topOilC > 95} />
              <Metric label="Load factor K" value={`${thermal.loadFactor.toFixed(3)} pu`} warn={thermal.loadFactor > 1} />
              <Metric label="Ageing rate" value={`${thermal.ageingRate.toFixed(2)}×`} warn={thermal.ageingRate > 2} />
              <Metric label="Core loss" value={`${thermal.noLoadLossW.toFixed(0)} W`} />
              <Metric label="Copper loss" value={`${thermal.loadLossW.toFixed(0)} W`} />
              <Metric label="Total losses" value={`${(thermal.totalLossesW / 1000).toFixed(2)} kW`} />
              <Metric label="Efficiency" value={`${thermal.efficiencyPct.toFixed(2)} %`} />
              <Metric label="Headroom" value={`${thermal.headroomKva.toFixed(0)} kVA`} warn={thermal.headroomKva < 10} />
              <Metric label="Condition" value={`${score}/100`} warn={score < 70} />
            </div>
            <ul className="mt-3 space-y-1 border-t border-[#1e3352] pt-2.5">
              {thermal.findings.slice(0, 3).map((f) => (
                <li key={f} className="text-[11px] leading-snug text-slate-400">• {f}</li>
              ))}
            </ul>
          </Panel>
        </div>

        {/* ---- Stat cards ---- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="METERS REPORTING" value={`${acc.meters - acc.offline}/${dataset.meterCount}`}
            tone={acc.offline > 0 ? "warn" : "ok"} sub={acc.offline > 0 ? `${acc.offline} offline` : "all online"} />
          <Stat label="AVERAGE VOLTAGE" value={avgVoltage > 0 ? `${avgVoltage.toFixed(1)} V` : "—"}
            tone={avgVoltage > 0 && avgVoltage < 220 ? "warn" : "ok"}
            sub={acc.minVoltage > 0 ? `min ${acc.minVoltage.toFixed(0)} V` : "awaiting data"} />
          <Stat label="PEAK LOAD TODAY" value={peak ? `${peak.kva.toFixed(0)} kVA` : "—"}
            tone={peak && peak.kva > rating ? "crit" : "ok"} sub={peak ? `at ${peak.label}` : "not yet seen"} />
          <Stat label="CURRENT INTERVAL" value={dataset.intervalLabels[interval_] ?? "--:--"}
            tone="ok" sub={running ? `batch ${batch + 1}/5 loading…` : paused ? "paused" : "idle"} />
        </div>

        {/* ---- Load curve ---- */}
        <Panel title={`24-HOUR LOAD CURVE — ${curve.length} of ${dataset.intervalCount} INTERVALS`}>
          <div className="hidden h-56 sm:block">
            <LoadCurve points={curve} ratingKva={rating} labels={dataset.intervalLabels} />
          </div>
          {/* Mobile: only the last six hours, so the line stays readable. */}
          <div className="h-44 sm:hidden">
            <LoadCurve points={curve} ratingKva={rating} labels={dataset.intervalLabels} windowSize={24} />
          </div>
        </Panel>

        {/* ---- Batches + alerts ---- */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Panel title="METER BATCH INGEST">
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((b) => {
                const done = batchTimes[b] != null;
                const active = running && batch === b && !done;
                return (
                  <div key={b} className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${done ? "bg-emerald-500" : active ? "animate-pulse bg-amber-400" : "bg-slate-700"}`} />
                    <span className="w-20 shrink-0 text-[11px] text-slate-400">Batch {b + 1}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#16243a]">
                      <div className={`h-full rounded-full transition-all duration-500 ${done ? "w-full bg-emerald-500" : active ? "w-1/2 bg-amber-400" : "w-0"}`} />
                    </div>
                    <span className="w-28 shrink-0 text-right font-mono text-[10px] text-slate-500">
                      {done ? `${dataset.batchSize} in ${batchTimes[b]!.toFixed(1)}s` : active ? "loading…" : "queued"}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 border-t border-[#1e3352] pt-2 text-[11px] text-slate-400">
              {batchTimes.every((t) => t != null)
                ? `Interval ${dataset.intervalLabels[interval_]} complete. Next: ${dataset.intervalLabels[interval_ + 1] ?? "end of day"}`
                : `${dataset.batchSize} meters per batch · ${(15 / speed).toFixed(1)}s between batches at ${speed}×`}
            </p>
          </Panel>

          <Panel title={`ALERTS (${alerts.length})`}>
            {alerts.length === 0 ? (
              <p className="py-8 text-center text-[12px] text-slate-500">
                No alerts. All parameters within limits.
              </p>
            ) : (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {alerts.map((a) => (
                  <li key={a.id} className={`rounded-lg border-l-2 px-3 py-2 text-[11px] leading-snug ${
                    a.severity === "CRITICAL" ? "border-red-500 bg-red-500/10 text-red-200"
                      : a.severity === "WARNING" ? "border-amber-400 bg-amber-400/10 text-amber-100"
                      : "border-emerald-500 bg-emerald-500/10 text-emerald-100"}`}>
                    <span className="font-mono font-bold">{a.time}</span> — {a.message}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </main>

      {/* ---- Controls ---- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#1e3352] bg-[#0d1b2a]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-2 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {!running ? (
              <button onClick={start} className="min-h-11 rounded-xl bg-emerald-500 px-6 text-sm font-bold text-[#0d1b2a] hover:bg-emerald-400">
                {curve.length ? "Resume monitoring" : "Start monitoring"}
              </button>
            ) : (
              <button onClick={() => setPaused((p) => !p)} className="min-h-11 rounded-xl bg-amber-400 px-6 text-sm font-bold text-[#0d1b2a] hover:bg-amber-300">
                {paused ? "Continue" : "Pause"}
              </button>
            )}
            <button onClick={reset} className="min-h-11 rounded-xl border border-[#2a4468] px-4 text-sm font-bold text-slate-300 hover:bg-[#16243a]">
              Reset
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">SPEED</span>
            {[1, 2, 5, 10].map((s) => (
              <button key={s} onClick={() => setSpeed(s)}
                className={`min-h-11 rounded-lg px-3 text-xs font-bold ${speed === s ? "bg-emerald-500 text-[#0d1b2a]" : "border border-[#2a4468] text-slate-300 hover:bg-[#16243a]"}`}>
                {s}×
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggleSound}
              className={`min-h-11 rounded-xl px-4 text-xs font-bold ${soundOn ? "bg-[#16243a] text-emerald-300" : "border border-[#2a4468] text-slate-300"}`}>
              {soundOn ? "Hum on" : "Hum off"}
            </button>
            <a href="/api/pdf/control-report" className="min-h-11 rounded-xl border border-[#2a4468] px-4 text-xs font-bold leading-[44px] text-slate-300 hover:bg-[#16243a]">
              Export report
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#1e3352] bg-[#101f33] p-3.5">
      <h2 className="mb-2.5 text-[10px] font-bold tracking-[0.14em] text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-bold ${warn ? "text-amber-300" : "text-slate-100"}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "ok" | "warn" | "crit" }) {
  const colour = tone === "crit" ? "text-red-400" : tone === "warn" ? "text-amber-300" : "text-emerald-400";
  return (
    <div className="rounded-xl border border-[#1e3352] bg-[#101f33] p-3.5">
      <p className="text-[10px] font-bold tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-xl font-extrabold sm:text-2xl ${colour}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}
