"use client";

/** The day's load curve, drawn as SVG. Extends as each interval completes. */
export function LoadCurve({
  points,
  ratingKva,
  labels,
  windowSize,
}: {
  points: { interval: number; kva: number }[];
  ratingKva: number;
  labels: string[];
  /** Show only the most recent N intervals — used to simplify on mobile. */
  windowSize?: number;
}) {
  const W = 900, H = 220, padL = 42, padR = 12, padT = 14, padB = 26;
  const shown = windowSize ? points.slice(-windowSize) : points;
  const firstIdx = shown.length ? shown[0].interval : 0;
  const lastIdx = windowSize
    ? firstIdx + windowSize - 1
    : Math.max(labels.length - 1, 1);

  const maxY = Math.max(ratingKva * 1.15, ...shown.map((p) => p.kva), 1);
  const x = (i: number) => padL + ((i - firstIdx) / Math.max(1, lastIdx - firstIdx)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / maxY) * (H - padT - padB);

  const path = shown.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.interval).toFixed(1)} ${y(p.kva).toFixed(1)}`).join(" ");
  const area = shown.length
    ? `${path} L ${x(shown[shown.length - 1].interval).toFixed(1)} ${H - padB} L ${x(firstIdx).toFixed(1)} ${H - padB} Z`
    : "";
  const last = shown[shown.length - 1];

  // Roughly six time ticks, whatever the window.
  const tickEvery = Math.max(1, Math.round((lastIdx - firstIdx) / 6));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="24 hour load curve">
      <defs>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={padL} y1={y(maxY * f)} x2={W - padR} y2={y(maxY * f)} stroke="#1e3352" strokeWidth="1" />
          <text x={padL - 6} y={y(maxY * f) + 3} textAnchor="end" fontSize="9" fill="#5d7290">
            {(maxY * f).toFixed(0)}
          </text>
        </g>
      ))}

      {/* Nameplate limit. */}
      <line x1={padL} y1={y(ratingKva)} x2={W - padR} y2={y(ratingKva)}
        stroke="#ff4d4d" strokeWidth="1.5" strokeDasharray="7 5" />
      <text x={W - padR} y={y(ratingKva) - 5} textAnchor="end" fontSize="9" fill="#ff8080">
        {ratingKva} kVA RATING
      </text>

      {area && <path d={area} fill="url(#curveFill)" />}
      {path && <path d={path} fill="none" stroke="#22c55e" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}

      {/* Live point. */}
      {last && (
        <g>
          <circle cx={x(last.interval)} cy={y(last.kva)} r="9" fill="#22c55e" opacity="0.28">
            <animate attributeName="r" values="6;13;6" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" />
          </circle>
          <circle cx={x(last.interval)} cy={y(last.kva)} r="4" fill="#22c55e" />
        </g>
      )}

      {Array.from({ length: Math.floor((lastIdx - firstIdx) / tickEvery) + 1 }, (_, k) => firstIdx + k * tickEvery)
        .filter((i) => labels[i])
        .map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#5d7290">
            {labels[i]}
          </text>
        ))}
    </svg>
  );
}
