import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, Badge, EmptyState, ActionLink } from "@/components/ui";
import {
  formatDate,
  formatNumber,
  formatRating,
  formatRelative,
} from "@/lib/format";

export const metadata: Metadata = { title: "Store dashboard" };
export const dynamic = "force-dynamic";

export default async function StoreDashboard() {
  const user = await requireRole("STORE_KEEPER", "ADMIN");

  const store = user.storeId
    ? await prisma.store.findUnique({ where: { id: user.storeId } })
    : null;

  // A store keeper sees their own store. An admin with no store sees all.
  const scope = user.storeId ? { currentStoreId: user.storeId } : {};

  const inStore = await prisma.transformer.findMany({
    where: { ...scope, status: "IN_STORE" },
    include: {
      manufacturer: { select: { name: true } },
      tests: { orderBy: { testedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const inTransit = await prisma.transformer.count({
    where: { status: "IN_TRANSIT", region: user.region ?? undefined },
  });

  // Intake testing is pending when no STORE_INTAKE test exists yet. That gap is
  // the store's real work queue.
  const awaitingTest = inStore.filter(
    (tx) => !tx.tests.some((t) => t.stage === "STORE_INTAKE"),
  );

  // Ready to dispatch: intake tested and passed.
  const readyToDispatch = inStore.filter((tx) =>
    tx.tests.some((t) => t.stage === "STORE_INTAKE" && t.passed),
  );

  const needsGNumber = inStore.filter((tx) => !tx.gNumber);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">
          {store?.name ?? "Store"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {store ? `${store.code} · ${store.county}` : "All stores"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="In store" value={formatNumber(inStore.length)} tone="info" hint="On the floor" />
        <StatTile label="Awaiting test" value={formatNumber(awaitingTest.length)} tone={awaitingTest.length ? "warning" : "neutral"} hint="Intake tests due" />
        <StatTile label="Ready to dispatch" value={formatNumber(readyToDispatch.length)} tone="success" hint="Tested and passed" />
        <StatTile label="In transit" value={formatNumber(inTransit)} hint="Left the yard" />
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-bold text-navy">Quick actions</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionLink href="/store/receive" variant="primary">Receive transformer</ActionLink>
          <ActionLink href="/store/dashboard#awaiting" variant="secondary">Record intake test</ActionLink>
          <ActionLink href="/store/dashboard#ready" variant="secondary">Dispatch to field</ActionLink>
          <ActionLink href="/transformers" variant="secondary">Search inventory</ActionLink>
        </div>
      </Card>

      {/* --- Awaiting intake test ------------------------------------------- */}
      <Card id="awaiting">
        <CardHeader title={`Awaiting intake test (${awaitingTest.length})`} />
        {awaitingTest.length ? (
          <ul className="divide-y divide-line">
            {awaitingTest.map((tx) => (
              <li key={tx.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/transformers/${tx.id}`}
                    className="text-sm font-bold text-navy hover:text-kplc"
                  >
                    {tx.gNumber ?? tx.serialNumber}
                  </Link>
                  <p className="text-xs text-ink-soft">
                    {formatRating(tx.ratingKva)} · {tx.manufacturer.name} ·
                    received {formatRelative(tx.createdAt)}
                  </p>
                </div>
                {!tx.gNumber && <Badge tone="warning">No G-Number</Badge>}
                <Link
                  href={`/store/test/${tx.id}`}
                  className="rounded-lg bg-kplc px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-kplc-light"
                >
                  Record test
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="Every unit in the store has been intake tested." />
        )}
      </Card>

      {/* --- Ready to dispatch ---------------------------------------------- */}
      <Card id="ready">
        <CardHeader title={`Ready to dispatch (${readyToDispatch.length})`} />
        {readyToDispatch.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-[11px] font-bold tracking-wide text-ink-soft">
                <tr>
                  <th className="px-5 py-3">G-NUMBER</th>
                  <th className="px-5 py-3">RATING</th>
                  <th className="px-5 py-3">MANUFACTURER</th>
                  <th className="px-5 py-3">WARRANTY FROM</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {readyToDispatch.map((tx) => (
                  <tr key={tx.id} className="hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link
                        href={`/transformers/${tx.id}`}
                        className="font-bold text-navy hover:text-kplc"
                      >
                        {tx.gNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-soft">{formatRating(tx.ratingKva)}</td>
                    <td className="px-5 py-3 text-ink-soft">{tx.manufacturer.name}</td>
                    <td className="px-5 py-3 text-ink-soft">{formatDate(tx.warrantyStart)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/store/dispatch/${tx.id}`}
                        className="rounded-lg bg-gold px-3 py-2 text-xs font-bold text-navy-dark transition-colors hover:bg-gold-dark"
                      >
                        Dispatch
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="Nothing is tested and ready to leave the store." />
        )}
      </Card>

      {needsGNumber.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60 p-5">
          <p className="text-sm font-bold text-amber-900">
            {needsGNumber.length} unit{needsGNumber.length === 1 ? "" : "s"} without a G-Number
          </p>
          <p className="mt-1 text-[13px] text-amber-800">
            A transformer with no G-Number is not yet on the register. This is
            the exact gap where paper loses units.
          </p>
        </Card>
      )}
    </div>
  );
}
