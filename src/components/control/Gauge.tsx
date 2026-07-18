"use client";

/**
 * Semi-circular loading gauge.
 *
 * The scale is in kVA, not kW: the nameplate is apparent power, so a gauge in
 * kW would read low whenever the power factor is below unity.
 *
 * The needle moves with a CSS transition rather than jumping, so a batch
 * landing looks like a real instrument settling.
 */
export function Gauge({
  valueKva,
  ratingKva,
  band,
}: {
  valueKva: number;
  ratingKva: number;
  band: "NORMAL" | "WATCH" | "OVERLOAD" | "CRITICAL";
}) {
  const max = ratingKva * 1.25; // headroom to show an overload, not peg the needle
  const pct = Math.max(0, Math.min(1, valueKva / max));
  const angle = -90 + pct * 180;

  const cx = 150, cy = 150, r = 112;
  const arc = (from: number, to: number) => {
    const a0 = (-90 + from * 180) * (Math.PI / 180);
    const a1 = (-90 + to * 180) * (Math.PI / 180);
    const x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0);
    const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };

  // Zone boundaries as a fraction of the full scale.
  const z1 = (ratingKva * 0.8) / max;
  const z2 = (ratingKva * 0.95) / max;

  const colour =
    band === "CRITICAL" ? "#ff4d4d" : band === "OVERLOAD" ? "#ff7a1a" :
    band === "WATCH" ? "#f5b700" : "#22c55e";

  return (
    <svg viewBox="0 0 300 205" className="h-full w-full" role="img" aria-label="Transformer loading gauge">
      <path d={arc(0, z1)} stroke="#22c55e" strokeWidth="20" fill="none" opacity="0.32" strokeLinecap="round" />
      <path d={arc(z1, z2)} stroke="#f5b700" strokeWidth="20" fill="none" opacity="0.32" />
      <path d={arc(z2, 1)} stroke="#ff4d4d" strokeWidth="20" fill="none" opacity="0.32" strokeLinecap="round" />

      {/* Live value drawn over the zones. */}
      <path
        d={arc(0, Math.max(0.001, pct))}
        stroke={colour}
        strokeWidth="20"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "d 700ms ease-out" }}
      />

      {/* Nameplate mark — 100 % of rating. */}
      {(() => {
        const a = (-90 + (ratingKva / max) * 180) * (Math.PI / 180);
        return (
          <line
            x1={cx + (r - 14) * Math.sin(a)} y1={cy - (r - 14) * Math.cos(a)}
            x2={cx + (r + 14) * Math.sin(a)} y2={cy - (r + 14) * Math.cos(a)}
            stroke="#ffffff" strokeWidth="2.5" opacity="0.85"
          />
        );
      })()}

      <g style={{ transition: "transform 700ms cubic-bezier(0.34,1.2,0.64,1)", transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${angle}deg)` }}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 16} stroke={colour} strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <circle cx={cx} cy={cy} r="9" fill="#0d1b2a" stroke={colour} strokeWidth="3" />

      <text x={cx} y={cy - 34} textAnchor="middle" fontSize="42" fontWeight="bold" fill={colour}>
        {valueKva.toFixed(0)}
      </text>
      <text x={cx} y={cy - 16} textAnchor="middle" fontSize="11" fill="#8fa3bf">kVA APPARENT</text>
      <text x={cx} y={cy + 34} textAnchor="middle" fontSize="15" fontWeight="bold" fill="#e6ecf5">
        {((valueKva / ratingKva) * 100).toFixed(1)}% of {ratingKva} kVA
      </text>

      <text x={38} y={cy + 24} textAnchor="middle" fontSize="9" fill="#5d7290">0</text>
      <text x={262} y={cy + 24} textAnchor="middle" fontSize="9" fill="#5d7290">{max.toFixed(0)}</text>
    </svg>
  );
}
