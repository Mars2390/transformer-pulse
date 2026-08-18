"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PhaseBars } from "./PhaseBars";
import { TransformerCutaway } from "./TransformerCutaway";
import type { ThermalResult } from "@/lib/transformer-thermal";

/**
 * The control centre, driven by KPLC's own EMDis telemetry.
 *
 * It replays recorded minutes rather than pretending to be a live link, and
 * says so on screen. Every figure here is computed by the same engine that
 * produces the load-analysis report and the PDF, so the room and the paperwork
 * can never disagree about a transformer.
 */

type Meta = {
  id: string; name: string;
  substationCode: string | null; substationName: string | null;
  gNumber: string | null; transformerId: string | null;
  make: string | null; ratingKva: number; ratedPhaseA: number; voltLL: number;
  readingCount: number; intervalSeconds: number;
  firstReadingAt: string; lastReadingAt: string;
  siteName: string | null; fuseSizeA: number | null;
  inspection: { inspectedOn: string; inspectorRef: string; loadingOk: boolean | null; loadAction: string | null; structure: string | null } | null;
};

type Frame = {
  cursor: number; end: boolean;
  now: {
    recordedAt: string;
    l1c: number | null; l2c: number | null; l3c: number | null; neutralC: number | null;
    kva: number | null; kw: number | null; kvar: number | null; pf: number | null; hz: number | null;
    thdPct: number | null; maxPhaseC: number | null; maxPhasePctRated: number | null;
    loadingPct: number | null; unbalancePct: number | null; neutralPctRated: number | null;
    avgVoltage: number | null;
  };
  thermal: { hotspotC: number; topOilC: number; ageingRate: number; band: string; totalLossesW: number; efficiencyPct: number };
  flags: { code: string; severity: "WARNING" | "CRITICAL"; text: string }[];
  window: { t: string; kva: number; maxPct: number; unb: number }[];
};

const SPEEDS = [1, 5, 15, 60, 240];
const AMBIENT = 28;

export function EmdisControlRoom({ datasetId }: { datasetId?: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [sound, setSound] = useState(false);
  const [log, setLog] = useState<{ t: string; text: string; sev: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const cursorRef = useRef(cursor);
  const cancelRef = useRef(false);
  playingRef.current = playing;
  speedRef.current = speed;
  cursorRef.current = cursor;

  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const q = datasetId ? `?dataset=${datasetId}` : "";
      const r = await fetch(`/api/control/emdis${q}`);
      const d = await r.json();
      setMeta(d.dataset ?? null);
      setLoading(false);
    })();
  }, [datasetId]);

  const fetchFrame = useCallback(
    async (at: number) => {
      if (!meta) return null;
      const r = await fetch(`/api/control/emdis?dataset=${meta.id}&cursor=${at}`);
      if (!r.ok) return null;
      const d: Frame = await r.json();
      return d;
    },
    [meta],
  );

  useEffect(() => {
    if (!meta) return;
    (async () => {
      const f = await fetchFrame(cursorRef.current);
      if (f) setFrame(f);
    })();
  }, [meta, fetchFrame]);

  // Async recursion rather than setInterval: a frame that takes longer than the
  // tick would otherwise stack requests until the browser gives up.
  useEffect(() => {
    if (!playing || !meta) return;
    cancelRef.current = false;

    (async () => {
      while (!cancelRef.current && playingRef.current) {
        const next = cursorRef.current + 1;
        if (next >= meta.readingCount) { setPlaying(false); break; }

        const f = await fetchFrame(next);
        if (!f || cancelRef.current) break;

        setFrame(f);
        setCursor(next);
        cursorRef.current = next;

        for (const fl of f.flags) {
          setLog((l) =>
            [{ t: new Date(f.now.recordedAt).toISOString().slice(11, 16), text: fl.text, sev: fl.severity }, ...l].slice(0, 60),
          );
        }

        // One recorded minute compressed by the speed multiplier.
        const delay = Math.max(40, (meta.intervalSeconds * 1000) / speedRef.current);
        await new Promise((r) => setTimeout(r, delay));
      }
    })();

    return () => { cancelRef.current = true; };
  }, [playing, meta, fetchFrame]);

  // 100 Hz, twice the 50 Hz supply: core laminations magnetostrict once per
  // half-cycle, so a transformer hums at double the line frequency.
  useEffect(() => {
    if (!sound) {
      audioRef.current?.ctx.close();
      audioRef.current = null;
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 100;
    osc2.type = "sine"; osc2.frequency.value = 200;
    gain.gain.value = 0.03;
    osc.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc2.start();
    audioRef.current = { ctx, gain };
    return () => { ctx.close(); };
  }, [sound]);

  useEffect(() => {
    if (!audioRef.current || !frame) return;
    // Louder under load — a working transformer is audibly busier.
    const pu = (frame.now.maxPhasePctRated ?? 0) / 100;
    audioRef.current.gain.gain.value = 0.015 + Math.min(0.06, pu * 0.05);
  }, [frame]);

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#0d1b2a] text-white/60">Loading control centre…</div>;
  }

  if (!meta) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0d1b2a] p-8 text-center">
        <div className="max-w-md">
          <p className="text-4xl">⚡</p>
          <h1 className="mt-4 text-xl font-extrabold text-white">No load data yet</h1>
          <p className="mt-2 text-sm text-white/60">
            Upload a KPLC EMDis export and the control centre will replay it, analysed minute by
            minute against the transformer&apos;s nameplate.
          </p>
          <Link href="/manager/emdis" className="mt-6 inline-block rounded-xl bg-kplc px-6 py-3 text-sm font-bold text-white">
            Upload EMDis data
          </Link>
        </div>
      </div>
    );
  }

  const n = frame?.now;
  const th = frame?.thermal;
  const pct = n?.maxPhasePctRated ?? 0;
  const sev = pct >= 100 ? "CRITICAL" : pct >= 80 ? "WARNING" : "OK";
  const accent = sev === "CRITICAL" ? "#dc2626" : sev === "WARNING" ? "#d97706" : "#0e8a4f";

  const thermalForCutaway: ThermalResult = {
    loadFactor: pct / 100, loadingPct: pct,
    topOilRiseK: (th?.topOilC ?? AMBIENT) - AMBIENT, topOilC: th?.topOilC ?? AMBIENT,
    hotspotRiseK: (th?.hotspotC ?? AMBIENT) - (th?.topOilC ?? AMBIENT), hotspotC: th?.hotspotC ?? AMBIENT,
    ageingRate: th?.ageingRate ?? 0, lossOfLifePerHour: th?.ageingRate ?? 0,
    noLoadLossW: 0, loadLossW: 0, totalLossesW: th?.totalLossesW ?? 0,
    efficiencyPct: th?.efficiencyPct ?? 0,
    band: (th?.band ?? "NORMAL") as ThermalResult["band"],
    headroomKva: 0, findings: [],
  };

  return (
    <div ref={shellRef} className="min-h-screen bg-[#0d1b2a] text-white">
      {/* --- Bar ------------------------------------------------------------ */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/30 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold">
            {meta.gNumber ? `G-${meta.gNumber}` : `Substation ${meta.substationCode}`}
            <span className="ml-2 font-normal text-white/50">{meta.ratingKva} kVA · {meta.make}</span>
          </p>
          <p className="truncate text-[11px] text-white/40">
            {meta.substationName ?? meta.siteName ?? "—"} · rated {meta.ratedPhaseA.toFixed(0)} A/phase
            {meta.fuseSizeA ? ` · ${meta.fuseSizeA} A fuse` : ""}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="rounded-lg px-4 py-2 text-xs font-bold text-white"
            style={{ backgroundColor: playing ? "#7b8383" : "#0e8a4f" }}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            onClick={() => { setCursor(0); cursorRef.current = 0; fetchFrame(0).then((f) => f && setFrame(f)); setLog([]); }}
            className="rounded-lg border border-white/20 px-3 py-2 text-xs font-bold"
          >
            ⏮ Restart
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`rounded px-2 py-1 text-[11px] font-bold ${speed === s ? "bg-white text-[#0d1b2a]" : "text-white/60"}`}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            onClick={() => setSound((s) => !s)}
            className={`rounded-lg border px-3 py-2 text-xs font-bold ${sound ? "border-kplc bg-kplc/20" : "border-white/20"}`}
            title="100 Hz core hum — twice the 50 Hz supply"
          >
            {sound ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              else shellRef.current?.requestFullscreen?.();
            }}
            className="rounded-lg border border-white/20 px-3 py-2 text-xs font-bold"
          >
            ⛶
          </button>
        </div>
      </header>

      {/* --- Timeline -------------------------------------------------------- */}
      <div className="border-b border-white/10 bg-black/20 px-4 py-2">
        <input
          type="range"
          min={0}
          max={Math.max(0, meta.readingCount - 1)}
          value={cursor}
          onChange={async (e) => {
            const v = Number(e.target.value);
            setCursor(v); cursorRef.current = v;
            const f = await fetchFrame(v);
            if (f) setFrame(f);
          }}
          className="w-full accent-emerald-500"
        />
        <div className="flex justify-between text-[10px] text-white/40">
          <span>{meta.firstReadingAt.slice(0, 16).replace("T", " ")}</span>
          <span className="font-mono text-white/70">
            {n ? new Date(n.recordedAt).toISOString().slice(0, 16).replace("T", " ") : "—"} UTC ·
            reading {cursor + 1} of {meta.readingCount.toLocaleString()}
          </span>
          <span>{meta.lastReadingAt.slice(0, 16).replace("T", " ")}</span>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1.1fr_320px]">
        {/* --- Phases ------------------------------------------------------- */}
        <section className="space-y-4">
          <Panel title="PHASE CURRENT vs RATED">
            <PhaseBars
              phases={[
                { name: "L1", amps: n?.l1c ?? 0, pctRated: ((n?.l1c ?? 0) / meta.ratedPhaseA) * 100 },
                { name: "L2", amps: n?.l2c ?? 0, pctRated: ((n?.l2c ?? 0) / meta.ratedPhaseA) * 100 },
                { name: "L3", amps: n?.l3c ?? 0, pctRated: ((n?.l3c ?? 0) / meta.ratedPhaseA) * 100 },
              ]}
              ratedA={meta.ratedPhaseA}
              fuseA={meta.fuseSizeA}
            />
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-white/50">NEUTRAL</span>
                <span className="font-mono">
                  <span className="font-bold">{(n?.neutralC ?? 0).toFixed(0)} A</span>
                  <span className="ml-2 opacity-60">{(n?.neutralPctRated ?? 0).toFixed(0)}% of rated</span>
                </span>
              </div>
              <p className="mt-1 text-[10px] text-white/40">
                A balanced three-phase load returns almost nothing here.
              </p>
            </div>
          </Panel>

          <Panel title="THE CONTRADICTION">
            <div className="grid grid-cols-2 gap-3">
              <Big label="TOTAL kVA" value={`${(n?.loadingPct ?? 0).toFixed(0)}%`} sub={`${(n?.kva ?? 0).toFixed(0)} kVA`} colour="#0e8a4f" />
              <Big label="HOTTEST PHASE" value={`${pct.toFixed(0)}%`} sub={`${(n?.maxPhaseC ?? 0).toFixed(0)} A`} colour={accent} />
            </div>
            {pct >= 100 && (n?.loadingPct ?? 0) < 100 && (
              <p className="mt-3 rounded bg-red-500/15 px-3 py-2 text-[11px] font-semibold text-red-300">
                A phase is over its rating while the kVA figure still reads under nameplate. This is
                the minute a conventional report cannot see.
              </p>
            )}
          </Panel>
        </section>

        {/* --- The transformer ---------------------------------------------- */}
        <section className="space-y-4">
          <Panel title={`THERMAL — IEC 60076-7 · ambient ${AMBIENT} °C`}>
            <div className="mx-auto max-w-[340px]">
              <TransformerCutaway thermal={thermalForCutaway} ambientC={AMBIENT} running={playing} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Hot-spot" value={`${(th?.hotspotC ?? 0).toFixed(0)}°C`} bad={(th?.hotspotC ?? 0) > 120} />
              <Stat label="Top oil" value={`${(th?.topOilC ?? 0).toFixed(0)}°C`} bad={(th?.topOilC ?? 0) > 105} />
              <Stat
                label="Ageing"
                value={`${(th?.ageingRate ?? 0) < 10 ? (th?.ageingRate ?? 0).toFixed(1) : (th?.ageingRate ?? 0).toFixed(0)}×`}
                bad={(th?.ageingRate ?? 0) > 2}
              />
            </div>
            {(th?.ageingRate ?? 0) > 2 && (
              <p className="mt-2 text-center text-[11px] font-semibold text-red-300">
                One hour here consumes {(th?.ageingRate ?? 0).toFixed(0)} hours of insulation life.
              </p>
            )}
            <p className="mt-2 text-center text-[10px] text-white/40">
              Driven by the hottest winding, not the kVA average.
            </p>
          </Panel>

          <Panel title="LOAD, LAST 90 MINUTES">
            <Sparkline data={frame?.window ?? []} />
          </Panel>
        </section>

        {/* --- Live readings and flags -------------------------------------- */}
        <section className="space-y-4">
          <Panel title="MEASURED NOW">
            <dl className="space-y-1.5 text-xs">
              <Row k="Active power" v={`${(n?.kw ?? 0).toFixed(1)} kW`} />
              <Row k="Apparent" v={`${(n?.kva ?? 0).toFixed(1)} kVA`} />
              <Row k="Reactive" v={`${(n?.kvar ?? 0).toFixed(1)} kvar`} />
              <Row k="Power factor" v={(n?.pf ?? 0).toFixed(3)} bad={(n?.pf ?? 1) < 0.9} />
              <Row k="Frequency" v={`${(n?.hz ?? 0).toFixed(2)} Hz`} bad={Math.abs((n?.hz ?? 50) - 50) > 1} />
              <Row k="Avg voltage" v={`${(n?.avgVoltage ?? 0).toFixed(1)} V`} bad={Math.abs(((n?.avgVoltage ?? 240) - 240) / 240) > 0.06} />
              <Row k="Unbalance" v={`${(n?.unbalancePct ?? 0).toFixed(1)}%`} bad={(n?.unbalancePct ?? 0) > 20} />
              <Row k="THD" v={`${(n?.thdPct ?? 0).toFixed(1)}%`} bad={(n?.thdPct ?? 0) > 8} />
            </dl>
          </Panel>

          <Panel title={`FLAGS · ${log.length}`}>
            {log.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-white/40">
                Nothing flagged yet. Press play.
              </p>
            ) : (
              <ul className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
                {log.map((l, i) => (
                  <li key={i} className="flex gap-2 rounded px-2 py-1.5 text-[11px]" style={{ backgroundColor: l.sev === "CRITICAL" ? "rgba(220,38,38,.15)" : "rgba(217,119,6,.12)" }}>
                    <span className="font-mono text-white/40">{l.t}</span>
                    <span className={l.sev === "CRITICAL" ? "font-bold text-red-300" : "text-amber-300"}>{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {meta.inspection?.loadingOk === false && (
            <Panel title="THE INSPECTOR">
              <p className="text-[11px] leading-relaxed text-white/70">
                {meta.inspection.inspectorRef} recorded loading as{" "}
                <strong className="text-red-300">NOT OKAY</strong>
                {meta.inspection.loadAction ? ` and prescribed ${meta.inspection.loadAction.replace(/_/g, " ")}` : ""}{" "}
                on {meta.inspection.inspectedOn.slice(0, 10)} — before this data was recorded.
              </p>
              <p className="mt-2 text-[11px] font-semibold text-white">He judged it by eye. The meters agree.</p>
            </Panel>
          )}

          {meta.transformerId && (
            <Link
              href={`/manager/load-analysis/${meta.id}`}
              className="block rounded-xl bg-kplc px-4 py-3 text-center text-xs font-bold text-white"
            >
              Full load analysis →
            </Link>
          )}
        </section>
      </div>

      <p className="px-4 pb-4 text-center text-[10px] text-white/30">
        Replaying recorded EMDis telemetry at {speed}× — {meta.intervalSeconds}-second intervals,
        analysed by the same engine that produces the reports.
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="mb-3 text-[10px] font-bold tracking-[0.12em] text-white/40">{title}</p>
      {children}
    </div>
  );
}

function Big({ label, value, sub, colour }: { label: string; value: string; sub: string; colour: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wide text-white/40">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums" style={{ color: colour }}>{value}</p>
      <p className="text-[11px] text-white/50">{sub}</p>
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-black/25 py-2">
      <p className="text-[10px] text-white/40">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${bad ? "text-red-400" : "text-white"}`}>{value}</p>
    </div>
  );
}

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="flex justify-between border-b border-white/5 pb-1">
      <dt className="text-white/50">{k}</dt>
      <dd className={`font-mono font-bold tabular-nums ${bad ? "text-red-400" : "text-white"}`}>{v}</dd>
    </div>
  );
}

/** Trailing window: bar colour is per-phase loading, height is kVA. */
function Sparkline({ data }: { data: { kva: number; maxPct: number }[] }) {
  if (!data.length) return <div className="h-24" />;
  const max = Math.max(...data.map((d) => d.kva), 1);
  return (
    <>
      <div className="flex h-24 items-end gap-[1px]">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex-1 rounded-t"
            style={{
              height: `${Math.max(2, (d.kva / max) * 100)}%`,
              backgroundColor: d.maxPct >= 100 ? "#dc2626" : d.maxPct >= 80 ? "#d97706" : "#0e8a4f",
            }}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-white/40">
        Height is kVA; colour is the hottest phase against its rating.
      </p>
    </>
  );
}
