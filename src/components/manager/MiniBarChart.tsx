/**
 * A small bar chart, hand-drawn as inline SVG. No charting library: these are
 * rectangles and text, they print cleanly in a report, and they add zero
 * kilobytes to a manager's tablet. Server-renderable — no "use client".
 */
export function MiniBarChart({
  data,
  colour = "#1e40af",
  height = 130,
}: {
  data: { label: string; value: number }[];
  colour?: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / data.length;
  const chartH = height - 26; // leave room for labels + value

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Bar chart"
    >
      {data.map((d, i) => {
        const h = (d.value / max) * chartH;
        const x = i * barW;
        return (
          <g key={d.label}>
            <rect
              x={x + barW * 0.2}
              y={chartH - h + 8}
              width={barW * 0.6}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx={1}
              fill={colour}
            />
            <text
              x={x + barW / 2}
              y={chartH - h + 5}
              textAnchor="middle"
              fontSize="6"
              fontWeight="700"
              fill="#0a1a4f"
            >
              {d.value > 0 ? d.value : ""}
            </text>
            <text
              x={x + barW / 2}
              y={height - 4}
              textAnchor="middle"
              fontSize="5.5"
              fill="#5b6480"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
