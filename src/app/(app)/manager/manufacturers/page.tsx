import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { buildManufacturerPerformance, fleetAverage } from "@/lib/manufacturer-performance";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Manufacturer performance" };
export const dynamic = "force-dynamic";

export default async function ManufacturerPerformancePage() {
  await requireRole("ADMIN", "MANAGER");
  const rows = await buildManufacturerPerformance();

  const avgFailureRate = fleetAverage(rows, "failureRatePct");
  const avgIrDecline = fleetAverage(rows, "avgIrDeclinePerYearMohm");
  const avgBdvDecline = fleetAverage(rows, "avgBdvDeclinePerYearKv");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Manufacturer performance</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Failure rate, service life, warranty recovery and test-value decline, computed from what
            actually happened to each manufacturer&apos;s units in the field. Sorted worst first. Red
            means worse than the fleet average, green means better.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/reports/manufacturer-performance?format=xlsx" className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc">
            XLSX
          </a>
          <a href="/api/pdf/manufacturer-performance" className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark">
            PDF
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[1100px] text-left text-xs">
          <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
            <tr>
              <th className="px-3 py-2">Manufacturer</th>
              <th className="px-3 py-2">Units in fleet</th>
              <th className="px-3 py-2">Failure rate</th>
              <th className="px-3 py-2">Avg service life</th>
              <th className="px-3 py-2">Claims filed</th>
              <th className="px-3 py-2">Settled</th>
              <th className="px-3 py-2">Disputed</th>
              <th className="px-3 py-2">Most common fault</th>
              <th className="px-3 py-2">Avg IR decline/yr</th>
              <th className="px-3 py-2">Avg BDV decline/yr</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-surface">
                <td className="px-3 py-2">
                  <Link href={`/manager/manufacturers/${r.id}`} className="font-bold text-navy hover:text-kplc">
                    {r.name}
                  </Link>
                  {r.country && <span className="ml-2 text-ink-soft">{r.country}</span>}
                </td>
                <td className="px-3 py-2 font-semibold text-navy">{formatNumber(r.unitsInFleet)}</td>
                <td className="px-3 py-2">
                  <Compared value={r.failureRatePct} fleetAvg={avgFailureRate} suffix="%" worseIsHigher />
                </td>
                <td className="px-3 py-2 text-navy">
                  {r.avgServiceLifeYears != null ? `${r.avgServiceLifeYears.toFixed(1)} yr` : "—"}
                </td>
                <td className="px-3 py-2 text-navy">{r.warrantyClaimsFiled}</td>
                <td className="px-3 py-2 text-kplc">{r.claimsSettled}</td>
                <td className="px-3 py-2 text-red-700">{r.claimsDisputed}</td>
                <td className="max-w-[220px] truncate px-3 py-2 text-ink-soft">{r.mostCommonFault ?? "—"}</td>
                <td className="px-3 py-2">
                  <Compared value={r.avgIrDeclinePerYearMohm} fleetAvg={avgIrDecline} suffix=" MΩ/yr" worseIsHigher />
                </td>
                <td className="px-3 py-2">
                  <Compared value={r.avgBdvDeclinePerYearKv} fleetAvg={avgBdvDecline} suffix=" kV/yr" worseIsHigher />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-ink-soft">No manufacturers on record.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        <strong className="text-navy">Failure rate</strong> is the share of a manufacturer&apos;s units with at
        least one recorded fault. <strong className="text-navy">Avg service life</strong> is years from
        installation (or manufacture year) to retirement for units no longer in service, or years in
        service so far for units still active. <strong className="text-navy">IR/BDV decline</strong> compares
        each unit&apos;s first and last test and averages the rate across units with at least two tests —
        a positive number means the value is falling over time, which is the direction that predicts failure.
      </p>
    </div>
  );
}

function Compared({
  value, fleetAvg, suffix, worseIsHigher,
}: { value: number | null; fleetAvg: number | null; suffix: string; worseIsHigher: boolean }) {
  if (value == null) return <span className="text-ink-soft">—</span>;
  const worse = fleetAvg != null && (worseIsHigher ? value > fleetAvg : value < fleetAvg);
  const better = fleetAvg != null && (worseIsHigher ? value < fleetAvg : value > fleetAvg);
  return (
    <span className={`font-bold ${worse ? "text-red-700" : better ? "text-kplc" : "text-navy"}`}>
      {value.toFixed(1)}{suffix}
    </span>
  );
}
