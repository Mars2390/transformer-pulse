"use client";

/**
 * A tiny trend line, drawn as inline SVG. No charting library: this is a
 * polyline and a few circles, it prints cleanly in a report, and it costs no
 * kilobytes on a field phone.
 *
 * `dangerBelow` / `dangerAbove` colour the whole line red when the LATEST point
 * breaches a standard — because a falling oil-BDV trend is the single clearest
 * sign of a transformer about to fail, and it should shout.
 */
export function Sparkline({
  points,
  unit,
  dangerBelow,
  dangerAbove,
  height = 44,
}: {
  points: { t: number; v: number }[];
  unit: string;
  dangerBelow?: number;
  dangerAbove?: number;
  height?: number;
}) {
  const values = points.filter((p) => Number.isFinite(p.v));
  if (values.length === 0) {
    return <span className="text-xs text-ink-soft">No data</span>;
  }

  const latest = values[values.length - 1].v;
  const breached =
    (dangerBelow != null && latest < dangerBelow) ||
    (dangerAbove != null && latest > dangerAbove);
  const colour = breached ? "#c02626" : "#1e40af";

  const width = 140;
  const pad = 4;

  if (values.length === 1) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold" style={{ color: colour }}>
          {latest}
          <span className="ml-0.5 text-[10px] font-normal text-ink-soft">{unit}</span>
        </span>
        <span className="text-[10px] text-ink-soft">(one reading)</span>
      </div>
    );
  }

  const vs = values.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const range = max - min || 1;

  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / range) * (height - 2 * pad);

  const path = values.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");

  // Direction of travel across the whole series — the headline a manager reads.
  const first = values[0].v;
  const delta = latest - first;
  const trend =
    Math.abs(delta) < range * 0.05 ? "steady" : delta < 0 ? "falling" : "rising";

  return (
    <div className="flex items-center gap-3">
      <svg width={width} height={height} className="shrink-0" aria-hidden="true">
        <polyline
          points={path}
          fill="none"
          stroke={colour}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.v)}
            r={i === values.length - 1 ? 3 : 1.75}
            fill={colour}
          />
        ))}
      </svg>
      <div className="text-xs">
        <span className="font-bold" style={{ color: colour }}>
          {latest}
          <span className="ml-0.5 font-normal text-ink-soft">{unit}</span>
        </span>
        <span
          className={`ml-1.5 ${
            breached ? "font-semibold text-red-600" : "text-ink-soft"
          }`}
        >
          {trend}
        </span>
      </div>
    </div>
  );
}
