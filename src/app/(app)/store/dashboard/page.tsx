import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, Badge, EmptyState } from "@/components/ui";
import { InventoryTable, type InventoryRow } from "@/components/store/InventoryTable";
import { computeWarranty, warrantyLabel } from "@/lib/warranty";
import { formatNumber, formatRating, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Store" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function StoreDashboard() {
  const user = await requireRole("STORE_KEEPER", "ADMIN");

  const store = user.storeId
    ? await prisma.store.findUnique({ where: { id: user.storeId } })
    : null;

  // A store keeper sees their store. An admin with no store sees everything.
  const scope = user.storeId ? { currentStoreId: user.storeId } : {};

  const [all, inTransit] = await Promise.all([
    prisma.transformer.findMany({
      where: user.storeId
        ? { OR: [{ currentStoreId: user.storeId }, { region: store?.region }] }
        : {},
      orderBy: { createdAt: "desc" },
      include: {
        manufacturer: { select: { name: true } },
        currentStore: { select: { name: true } },
        tests: {
          where: { stage: "STORE_INTAKE" },
          orderBy: { testedAt: "desc" },
          take: 1,
          select: { passed: true },
        },
      },
    }),
    prisma.transformer.count({
      where: { status: "IN_TRANSIT", region: store?.region ?? undefined },
    }),
  ]);

  const inStore = all.filter((tx) => tx.status === "IN_STORE");

  // The store's real work queues, derived from whether an intake test exists —
  // not from a flag someone has to remember to set.
  const awaitingTest = inStore
    .filter((tx) => tx.tests.length === 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // oldest first

  const readyToDispatch = inStore
    .filter((tx) => tx.tests[0]?.passed === true)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const failedTest = inStore.filter((tx) => tx.tests[0]?.passed === false);
  const needsGNumber = inStore.filter((tx) => !tx.gNumber);

  const rows: InventoryRow[] = all.map((tx) => {
    const warranty = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
    return {
      id: tx.id,
      gNumber: tx.gNumber,
      serialNumber: tx.serialNumber,
      manufacturer: tx.manufacturer.name,
      ratingKva: tx.ratingKva,
      status: tx.status,
      testState:
        tx.tests.length === 0 ? "UNTESTED" : tx.tests[0].passed ? "PASSED" : "FAILED",
      warrantyLabel: warrantyLabel(warranty),
      warrantyState: warranty.state,
      location: tx.currentSiteName ?? tx.currentStore?.name ?? "—",
      // Serialise: a Date cannot cross into a client component.
      receivedAt: tx.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      {/* --- Header --------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy">
            {store?.name ?? "All stores"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {store ? `${store.code} · ${store.county}` : "Administrator view"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href="/api/reports/store-inventory?format=csv"
            className="rounded-xl border border-line bg-white px-4 py-2.5 text-xs font-bold text-navy transition-colors hover:border-navy/30"
          >
            Export CSV
          </a>
          <a
            href="/api/reports/store-inventory?format=xlsx"
            className="rounded-xl border border-line bg-white px-4 py-2.5 text-xs font-bold text-navy transition-colors hover:border-navy/30"
          >
            Export XLSX
          </a>
          <Link
            href="/store/receive"
            className="rounded-xl bg-kplc px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
          >
            + Receive transformer
          </Link>
        </div>
      </div>

      {/* --- Stats ---------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="In store" value={formatNumber(inStore.length)} tone="info" hint="On the floor" />
        <StatTile
          label="Awaiting test"
          value={formatNumber(awaitingTest.length)}
          tone={awaitingTest.length ? "warning" : "neutral"}
          hint="Intake tests due"
        />
        <StatTile
          label="Ready to dispatch"
          value={formatNumber(readyToDispatch.length)}
          tone="success"
          hint="Tested and passed"
        />
        <StatTile label="In transit" value={formatNumber(inTransit)} hint="Left the yard" />
      </div>

      {/* --- Warnings ------------------------------------------------------- */}
      {needsGNumber.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-bold text-amber-900">
            {needsGNumber.length} transformer{needsGNumber.length === 1 ? " has" : "s have"} no G-Number
          </p>
          <p className="mt-1 text-[13px] text-amber-800">
            Until a G-Number is assigned, a unit is not on the register. This is
            the exact gap where paper loses transformers.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {needsGNumber.slice(0, 6).map((tx) => (
              <Link
                key={tx.id}
                href={`/store/test/${tx.id}`}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs font-bold text-amber-900 transition-colors hover:border-amber-500"
              >
                {tx.serialNumber}
              </Link>
            ))}
          </div>
        </div>
      )}

      {failedTest.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-bold text-red-900">
            {failedTest.length} transformer{failedTest.length === 1 ? "" : "s"} failed the intake test
          </p>
          <p className="mt-1 text-[13px] text-red-800">
            The system will refuse to dispatch these. They should go back to the
            manufacturer under warranty, not to a pole.
          </p>
        </div>
      )}

      {/* --- Work queues ---------------------------------------------------- */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={`Awaiting intake test (${awaitingTest.length})`} />
          {awaitingTest.length ? (
            <ul className="divide-y divide-line">
              {awaitingTest.map((tx) => {
                const waitingDays = Math.floor((Date.now() - tx.createdAt.getTime()) / DAY);
                return (
                  <li key={tx.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-bold text-navy">
                        {tx.gNumber ?? tx.serialNumber}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {formatRating(tx.ratingKva)} · {tx.manufacturer.name} ·{" "}
                        {formatRelative(tx.createdAt)}
                      </p>
                    </div>
                    {waitingDays >= 7 && (
                      <Badge tone="warning">{waitingDays} days waiting</Badge>
                    )}
                    <Link
                      href={`/store/test/${tx.id}`}
                      className="rounded-lg bg-kplc px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-kplc-light"
                    >
                      Record test
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState message="Every unit on the floor has been tested." />
          )}
        </Card>

        <Card>
          <CardHeader title={`Ready to dispatch (${readyToDispatch.length})`} />
          {readyToDispatch.length ? (
            <ul className="divide-y divide-line">
              {readyToDispatch.map((tx) => {
                const inStoreDays = Math.floor((Date.now() - tx.createdAt.getTime()) / DAY);
                return (
                  <li key={tx.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-bold text-navy">
                        {tx.gNumber ?? tx.serialNumber}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {formatRating(tx.ratingKva)} · {tx.manufacturer.name} ·{" "}
                        {inStoreDays} days in store
                      </p>
                    </div>
                    <Badge tone="success">Passed</Badge>
                    <Link
                      href={`/store/dispatch/${tx.id}`}
                      className="rounded-lg bg-gold px-3 py-2 text-[11px] font-bold text-navy-dark transition-colors hover:bg-gold-dark"
                    >
                      Dispatch
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState message="Nothing is tested and ready to leave." />
          )}
        </Card>
      </div>

      {/* --- Inventory ------------------------------------------------------ */}
      <Card>
        <CardHeader title={`Inventory (${rows.length})`} />
        <InventoryTable rows={rows} />
      </Card>
    </div>
  );
}
