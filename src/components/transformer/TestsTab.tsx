"use client";

import { Badge, EmptyState } from "@/components/ui";
import { Sparkline } from "./Sparkline";
import type { StoryTest } from "./story-types";
import { formatDate } from "@/lib/format";
import { IR_MIN_MOHM, OIL_BDV_MIN_KV } from "@/lib/health";

const STAGE_LABEL: Record<string, string> = {
  STORE_INTAKE: "Store intake",
  PRE_DISPATCH: "Pre-dispatch",
  SITE_COMMISSIONING: "Commissioning",
  ROUTINE: "Routine",
  POST_FAULT: "Post-fault",
};

/**
 * Every test over time, plus the three trends that predict a failure.
 *
 * A single passing test tells you a transformer was fine on one day. The TREND
 * across tests tells you whether it is dying — oil BDV sliding 62 → 48 → 31 kV
 * is the story of a unit weeks from a fault, and the sparklines make that
 * visible at a glance.
 */
export function TestsTab({ tests }: { tests: StoryTest[] }) {
  if (tests.length === 0) {
    return <EmptyState message="No tests have been recorded for this transformer yet." />;
  }

  // Oldest first for trend lines; newest first for the table.
  const chronological = [...tests].sort(
    (a, b) => new Date(a.testedAt).getTime() - new Date(b.testedAt).getTime(),
  );
  const newestFirst = [...chronological].reverse();

  const series = (key: keyof StoryTest) =>
    chronological
      .filter((t) => t[key] != null)
      .map((t) => ({ t: new Date(t.testedAt).getTime(), v: Number(t[key]) }));

  return (
    <div className="space-y-6">
      {/* --- Trends ------------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <TrendCard title="Oil breakdown voltage" note={`fault below ${OIL_BDV_MIN_KV} kV`}>
          <Sparkline points={series("oilBdvKv")} unit=" kV" dangerBelow={OIL_BDV_MIN_KV} />
        </TrendCard>
        <TrendCard title="Insulation resistance HV" note={`fault below ${IR_MIN_MOHM} MΩ`}>
          <Sparkline points={series("insulationResistanceHvMohm")} unit=" MΩ" dangerBelow={IR_MIN_MOHM} />
        </TrendCard>
        <TrendCard title="Insulation resistance LV" note={`fault below ${IR_MIN_MOHM} MΩ`}>
          <Sparkline points={series("insulationResistanceLvMohm")} unit=" MΩ" dangerBelow={IR_MIN_MOHM} />
        </TrendCard>
      </div>

      {/* --- Table ------------------------------------------------------- */}
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">DATE</th>
              <th className="px-4 py-3">STAGE</th>
              <th className="px-4 py-3">IR HV</th>
              <th className="px-4 py-3">IR LV</th>
              <th className="px-4 py-3">RATIO DEV</th>
              <th className="px-4 py-3">OIL BDV</th>
              <th className="px-4 py-3">RESULT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {newestFirst.map((test) => (
              <tr key={test.id} className="hover:bg-surface">
                <td className="px-4 py-3 text-ink-soft">{formatDate(test.testedAt)}</td>
                <td className="px-4 py-3 font-medium text-navy">
                  {STAGE_LABEL[test.stage] ?? test.stage}
                </td>
                <Cell value={test.insulationResistanceHvMohm} unit="MΩ" bad={(v) => v < IR_MIN_MOHM} />
                <Cell value={test.insulationResistanceLvMohm} unit="MΩ" bad={(v) => v < IR_MIN_MOHM} />
                <Cell value={test.turnsRatioDeviationPct} unit="%" bad={(v) => Math.abs(v) > 0.5} />
                <Cell value={test.oilBdvKv} unit="kV" bad={(v) => v < OIL_BDV_MIN_KV} />
                <td className="px-4 py-3">
                  <Badge tone={test.passed ? "success" : "danger"}>
                    {test.passed ? "Pass" : "Fail"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrendCard({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs font-bold text-navy">{title}</p>
      <p className="text-[11px] text-ink-soft">{note}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Cell({
  value,
  unit,
  bad,
}: {
  value: number | null;
  unit: string;
  bad: (v: number) => boolean;
}) {
  if (value == null) return <td className="px-4 py-3 text-ink-soft/50">—</td>;
  const isBad = bad(value);
  return (
    <td className={`px-4 py-3 font-medium ${isBad ? "text-red-600" : "text-navy"}`}>
      {value}
      <span className="ml-0.5 text-[10px] font-normal text-ink-soft">{unit}</span>
    </td>
  );
}
