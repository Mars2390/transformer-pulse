/**
 * Three phases against their rated current.
 *
 * The rated line is drawn at a fixed position so the bars can overshoot it
 * visibly. A chart that rescales to fit its largest value would make 121% of
 * rating look exactly like 80% — which is the misreading this whole screen
 * exists to correct.
 */
export function PhaseBars({
  phases,
  ratedA,
  fuseA,
  compact,
}: {
  phases: { name: string; amps: number; pctRated: number }[];
  ratedA: number;
  fuseA?: number | null;
  compact?: boolean;
}) {
  // Rated sits at 70% of the track, leaving room to show an overload.
  const SCALE = 1 / 0.7;
  const maxPct = Math.max(100 * SCALE, ...phases.map((p) => p.pctRated * 1.1));
  const pos = (pct: number) => Math.min(100, (pct / maxPct) * 100);

  const colour = (pct: number) =>
    pct >= 100 ? "#dc2626" : pct >= 80 ? "#d97706" : "#0e8a4f";

  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"}>
      {phases.map((p) => (
        <div key={p.name}>
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-bold tracking-wide" style={{ color: colour(p.pctRated) }}>
              {p.name}
            </span>
            <span className="font-mono tabular-nums">
              <span className="font-bold" style={{ color: colour(p.pctRated) }}>
                {p.amps.toFixed(0)} A
              </span>
              <span className="ml-2 opacity-60">{p.pctRated.toFixed(0)}%</span>
            </span>
          </div>
          <div className={`relative mt-1 overflow-hidden rounded ${compact ? "h-3" : "h-5"} bg-black/25`}>
            <div
              className="h-full rounded transition-[width] duration-500 ease-out"
              style={{ width: `${pos(p.pctRated)}%`, backgroundColor: colour(p.pctRated) }}
            />
            {/* Rated current */}
            <div
              className="absolute inset-y-0 w-px bg-white/85"
              style={{ left: `${pos(100)}%` }}
              title={`Rated ${ratedA.toFixed(0)} A`}
            />
            {/* Fuse rating, when the inspection register recorded one */}
            {fuseA ? (
              <div
                className="absolute inset-y-0 w-px bg-amber-300"
                style={{ left: `${pos((fuseA / ratedA) * 100)}%` }}
                title={`Fuse ${fuseA} A`}
              />
            ) : null}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3 pt-0.5 text-[10px] opacity-70">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-px bg-white/85" /> rated {ratedA.toFixed(0)} A
        </span>
        {fuseA ? (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-px bg-amber-300" /> fuse {fuseA} A
          </span>
        ) : null}
      </div>
    </div>
  );
}
