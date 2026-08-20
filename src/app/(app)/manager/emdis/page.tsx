import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmdisUploader } from "@/components/manager/EmdisUploader";
import { EmdisDatasetList } from "@/components/manager/EmdisDatasetList";

export const metadata: Metadata = { title: "Load data" };
export const dynamic = "force-dynamic";

export default async function EmdisPage() {
  const user = await requireRole("ADMIN", "MANAGER");

  // Counted on the server so the banner is right on first paint. A staging
  // queue that appears a second after the page does is a queue people miss.
  const stagedCount = await prisma.emdisDataset.count({ where: { staged: true } });

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
          defect raises an alert without anyone asking. Data that already exists is refused, and data
          whose transformer cannot be identified is held for review rather than counted toward the
          wrong unit.
        </p>
      </div>

      {stagedCount > 0 && (
        <Link
          href="/manager/staging"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm hover:border-amber-400"
        >
          <span className="font-bold text-amber-900">
            {stagedCount} load dataset{stagedCount === 1 ? "" : "s"} waiting to be matched
          </span>
          <span className="text-xs text-amber-900">
            Held out of every analysis until someone says which transformer they belong to.
          </span>
          <span className="ml-auto text-xs font-bold text-amber-900">Review →</span>
        </Link>
      )}

      <EmdisUploader />

      <EmdisDatasetList isAdmin={user.role === "ADMIN"} />
    </div>
  );
}
