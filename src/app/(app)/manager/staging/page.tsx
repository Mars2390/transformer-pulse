import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StagingReview } from "@/components/manager/StagingReview";
import { EmdisStagingReview } from "@/components/manager/EmdisStagingReview";

export const metadata: Metadata = { title: "Staging" };
export const dynamic = "force-dynamic";

/**
 * Two staging queues, one screen.
 *
 * They are the same problem seen from two sides: a real asset that the register
 * does not know about. The inspection queue holds transformers KPLC has visited
 * but never registered; the load queue holds telemetry from a meter whose
 * transformer cannot be identified. Both are resolved the same way — a named
 * human decides — and both refuse to guess.
 *
 * The tab is a URL parameter rather than client state so that the link on the
 * load-data page can point straight at the load queue.
 */

type Search = { tab?: string };

export default async function StagingPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole("ADMIN", "MANAGER");
  const { tab } = await searchParams;

  const stagedLoad = await prisma.emdisDataset.count({ where: { staged: true } });
  // Load data is the queue people arrive here for when something is waiting;
  // inspections are the long-standing backlog and stay the default otherwise.
  const active = tab === "inspections" ? "inspections" : tab === "load" ? "load" : stagedLoad > 0 ? "load" : "inspections";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Staging</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Real data that the register cannot yet place. Nothing here is resolved automatically — the
          inspection register has unreadable serials and defaced plate numbers, and load exports name a
          meter rather than an asset. Guessing would put duplicates on the register and load history on
          the wrong transformer, so a named human decides instead.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line">
        <Tab href="/manager/staging?tab=load" active={active === "load"} count={stagedLoad}>
          Load data
        </Tab>
        <Tab href="/manager/staging?tab=inspections" active={active === "inspections"}>
          Inspected transformers
        </Tab>
      </div>

      {active === "load" ? (
        <>
          <p className="max-w-3xl text-sm text-ink-soft">
            Load telemetry whose transformer could not be identified from its serial or substation code.
            The readings are stored in full and nothing is lost — but they count toward no
            transformer&apos;s analysis, raise no alerts, and appear in no score until someone says which
            unit they belong to.
          </p>
          <EmdisStagingReview />
        </>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-ink-soft">
            Real transformers that KPLC inspected but which are not yet on this register. Promoting one
            creates the asset with a sealed genesis event and its full inspection history.
          </p>
          <StagingReview />
        </>
      )}
    </div>
  );
}

function Tab({
  href, active, count, children,
}: {
  href: string;
  active: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
        active ? "border-kplc text-kplc" : "border-transparent text-ink-soft hover:text-navy"
      }`}
    >
      {children}
      {count != null && count > 0 && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
          {count}
        </span>
      )}
    </Link>
  );
}
