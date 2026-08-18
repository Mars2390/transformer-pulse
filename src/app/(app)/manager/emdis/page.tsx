import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { listDatasets } from "@/lib/emdis-read";
import { EmdisUploader } from "@/components/manager/EmdisUploader";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Load data" };
export const dynamic = "force-dynamic";

export default async function EmdisPage() {
  await requireRole("ADMIN", "MANAGER");
  const datasets = await listDatasets();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Load data</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Load telemetry from any source — KPLC&apos;s EMDis reports and plain column tables are both
          understood, the format detected automatically. Each upload is analysed on ingest — per-phase
          loading against rated current, unbalance, neutral, harmonics and thermal ageing — and any
          defect raises an alert without anyone asking.
        </p>
      </div>

      <EmdisUploader />

      {datasets.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-bold text-navy">Datasets</h2>
          </div>
          <ul className="divide-y divide-line">
            {datasets.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-navy">
                    {d.transformer?.gNumber ? `G-${d.transformer.gNumber}` : d.substationCode ?? d.name}
                    {d.transformer?.ratingKva ? (
                      <span className="ml-2 font-normal text-ink-soft">{d.transformer.ratingKva} kVA</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    {d.readingCount.toLocaleString()} readings at {d.intervalSeconds}s ·{" "}
                    {d.firstReadingAt.toISOString().slice(0, 10)} to{" "}
                    {d.lastReadingAt.toISOString().slice(0, 10)} · {d.uploadedByName},{" "}
                    {formatRelative(d.createdAt)}
                  </p>
                  {!d.transformerId && (
                    <p className="mt-0.5 text-[11px] font-bold text-amber-700">
                      Not matched to a transformer — analysis uses the file&apos;s own rating
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/manager/load-analysis/${d.id}`}
                    className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark"
                  >
                    Load analysis
                  </Link>
                  <Link
                    href={`/kplc-control?dataset=${d.id}`}
                    className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc"
                  >
                    Control centre
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
