"use client";

import { thermalColour, type ThermalResult } from "@/lib/transformer-thermal";

/**
 * A cutaway of an oil-immersed distribution transformer, coloured by the
 * computed thermal state.
 *
 * Drawn as SVG rather than WebGL 3D on purpose: this has to stay readable on a
 * projector and a phone, print into the PDF report, and never drop frames while
 * the replay is running. A cross-section also shows the thing an engineer
 * actually wants — where the heat is inside the tank — which a rotating 3D
 * exterior would hide.
 *
 * Geometry follows a real ONAN unit: core limbs with LV windings wound directly
 * on them and HV windings outside, oil filling the tank, radiator fins for
 * convection, a conservator above, and HV/LV bushings on the lid.
 */
export function TransformerCutaway({
  thermal,
  ambientC,
  running,
}: {
  thermal: ThermalResult;
  ambientC: number;
  running: boolean;
}) {
  const oilColour = thermalColour(thermal.topOilC);
  // Oil at the bottom of the tank sits roughly the winding gradient cooler.
  const bottomOilC = Math.max(ambientC, thermal.topOilC - thermal.hotspotRiseK - 8);
  const bottomColour = thermalColour(bottomOilC);
  const windingColour = thermalColour(thermal.hotspotC);
  const coreColour = thermalColour(thermal.topOilC - 4);

  // Convection speeds up with load: hotter oil rises faster.
  const flowSeconds = Math.max(1.6, 6 - thermal.loadFactor * 3.4);
  const hot = thermal.band === "CRITICAL" || thermal.band === "OVERLOAD";

  return (
    <svg viewBox="0 0 320 300" className="h-full w-full" role="img" aria-label="Transformer thermal cutaway">
      <defs>
        <linearGradient id="oilGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={oilColour} stopOpacity="0.92" />
          <stop offset="100%" stopColor={bottomColour} stopOpacity="0.92" />
        </linearGradient>
        <linearGradient id="windGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={windingColour} />
          <stop offset="100%" stopColor={thermalColour(thermal.hotspotC - 12)} />
        </linearGradient>
        <radialGradient id="hotspotGlow">
          <stop offset="0%" stopColor={windingColour} stopOpacity="0.95" />
          <stop offset="100%" stopColor={windingColour} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ---- Conservator (oil expansion vessel) ---- */}
      <rect x="196" y="16" width="72" height="24" rx="12" fill="#243447" stroke="#3d5372" strokeWidth="1.5" />
      <rect x="200" y="26" width="64" height="12" rx="6" fill={oilColour} opacity="0.75" />
      <text x="232" y="12" textAnchor="middle" fontSize="7" fill="#7b8ba3">CONSERVATOR</text>
      <line x1="232" y1="40" x2="232" y2="56" stroke="#3d5372" strokeWidth="3" />

      {/* ---- Bushings: 3 HV (tall) + 4 LV (short) ---- */}
      {[74, 100, 126].map((x, i) => (
        <g key={`hv${i}`}>
          <line x1={x} y1="34" x2={x} y2="56" stroke="#8fa3bf" strokeWidth="3" />
          {[0, 1, 2].map((s) => (
            <ellipse key={s} cx={x} cy={38 + s * 7} rx="8" ry="3" fill="#c8d4e4" stroke="#8fa3bf" strokeWidth="0.6" />
          ))}
        </g>
      ))}
      <text x="100" y="26" textAnchor="middle" fontSize="7" fill="#7b8ba3">HV 11 kV</text>
      {[150, 166, 182].map((x, i) => (
        <g key={`lv${i}`}>
          <line x1={x} y1="44" x2={x} y2="56" stroke="#8fa3bf" strokeWidth="2.5" />
          <ellipse cx={x} cy="46" rx="5.5" ry="2.4" fill="#c8d4e4" />
        </g>
      ))}
      <text x="166" y="38" textAnchor="middle" fontSize="7" fill="#7b8ba3">LV 415 V</text>

      {/* ---- Radiator fins ---- */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={`radL${i}`}>
          <rect x={22} y={78 + i * 26} width="26" height="16" rx="3"
            fill={thermalColour(bottomOilC + (4 - i) * 3)} opacity="0.85" />
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={`radR${i}`} x={272} y={78 + i * 26} width="26" height="16" rx="3"
          fill={thermalColour(bottomOilC + (4 - i) * 3)} opacity="0.85" />
      ))}

      {/* ---- Tank + oil ---- */}
      <rect x="48" y="56" width="224" height="196" rx="8" fill="#16243a" stroke="#3d5372" strokeWidth="2" />
      <rect x="54" y="62" width="212" height="184" rx="5" fill="url(#oilGrad)" />

      {/* Oil convection: hot oil rises at the windings, falls at the tank wall. */}
      {running && [70, 250].map((x, i) => (
        <g key={`flow${i}`}>
          {[0, 1, 2].map((k) => (
            <circle key={k} cx={x} cy={230} r="2.4" fill="#ffffff" opacity="0.35">
              <animate attributeName="cy" values="230;72" dur={`${flowSeconds}s`}
                begin={`${k * (flowSeconds / 3)}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.45;0" dur={`${flowSeconds}s`}
                begin={`${k * (flowSeconds / 3)}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </g>
      ))}

      {/* ---- Core limbs with LV then HV windings ---- */}
      {[100, 160, 220].map((cx, i) => (
        <g key={`limb${i}`}>
          {/* laminated core limb */}
          <rect x={cx - 9} y="78" width="18" height="152" rx="2" fill={coreColour} opacity="0.9" />
          <rect x={cx - 9} y="78" width="18" height="152" rx="2" fill="none" stroke="#0d1b2a" strokeWidth="0.5" />
          {/* LV winding — wound directly on the core */}
          <rect x={cx - 20} y="92" width="11" height="124" rx="3" fill="url(#windGrad)" opacity="0.95" />
          <rect x={cx + 9} y="92" width="11" height="124" rx="3" fill="url(#windGrad)" opacity="0.95" />
          {/* HV winding — outside the LV */}
          <rect x={cx - 29} y="98" width="8" height="112" rx="3" fill="url(#windGrad)" opacity="0.78" />
          <rect x={cx + 21} y="98" width="8" height="112" rx="3" fill="url(#windGrad)" opacity="0.78" />
        </g>
      ))}
      {/* top and bottom yokes closing the magnetic circuit */}
      <rect x="88" y="70" width="144" height="12" rx="2" fill={coreColour} opacity="0.9" />
      <rect x="88" y="226" width="144" height="12" rx="2" fill={coreColour} opacity="0.9" />

      {/* ---- Hot spot: upper third of the winding, where IEC places it ---- */}
      <circle cx="160" cy="112" r="26" fill="url(#hotspotGlow)">
        {hot && <animate attributeName="r" values="20;30;20" dur="1.6s" repeatCount="indefinite" />}
      </circle>
      <circle cx="160" cy="112" r="4.5" fill="#fff" opacity="0.95">
        {hot && <animate attributeName="opacity" values="1;0.35;1" dur="1s" repeatCount="indefinite" />}
      </circle>
      <text x="160" y="104" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#ffffff">
        {thermal.hotspotC.toFixed(0)}°C
      </text>
      <text x="160" y="130" textAnchor="middle" fontSize="6.5" fill="#e6ecf5">HOT SPOT</text>

      {/* ---- Labels ---- */}
      <text x="160" y="266" textAnchor="middle" fontSize="7.5" fill="#7b8ba3">
        CORE · LV WINDING · HV WINDING · MINERAL OIL (ONAN)
      </text>
      <text x="60" y="70" fontSize="7" fill="#e6ecf5">TOP OIL {thermal.topOilC.toFixed(0)}°C</text>
      <text x="60" y="244" fontSize="7" fill="#e6ecf5">BOTTOM OIL {bottomOilC.toFixed(0)}°C</text>
      <text x="160" y="284" textAnchor="middle" fontSize="7" fill="#7b8ba3">
        AMBIENT {ambientC.toFixed(0)}°C · IEC 60076-7 STEADY STATE
      </text>
    </svg>
  );
}
