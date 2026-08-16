import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TransactionForm, type MovableUnit, type Destination } from "@/components/transactions/TransactionForm";
import { movementsFor } from "@/lib/transactions";

export const metadata: Metadata = { title: "Move stock" };
export const dynamic = "force-dynamic";

/**
 * A store keeper moving stock somewhere other than a site.
 *
 * Dispatch to a site keeps its own dedicated screen, because it carries the
 * intake-test rule and a destination that is a place rather than a record. This
 * one covers the movements that had no home: store to store, store to workshop,
 * store back to the manufacturer, and a condemned unit leaving a workshop.
 */
export default async function StoreTransferPage() {
  const user = await requireRole("STORE_KEEPER", "MANAGER", "ADMIN");

  // Every movement this role may raise, not just the ones starting at a store.
  // A store keeper who also runs a workshop needs Workshop to Site, and hiding
  // it made the list look shorter than the system's actual capability.
  const allowed = movementsFor(user.role).map((m) => m.key);

  const [held, destinations] = await Promise.all([
    // The WHOLE fleet, not just this store's shelf. Filtering the query was
    // what made the form look empty: a keeper whose stock was all awaiting
    // approval, or whose units had no currentStoreId, saw nothing at all and
    // had no way to tell whether the data or the screen was broken. Custody is
    // now enforced per row, visibly, instead of by an invisible where clause.
    prisma.transformer.findMany({
      select: {
        id: true,
        gNumber: true,
        serialNumber: true,
        ratingKva: true,
        status: true,
        currentSiteName: true,
        manufacturer: { select: { name: true } },
        currentStore: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { gNumber: "asc" }],
      take: 2000,
    }),
    prisma.store.findMany({
      where: { active: true, ...(user.storeId ? { id: { not: user.storeId } } : {}) },
      select: { id: true, name: true, kind: true, region: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const units: MovableUnit[] = held.map((t) => ({
    id: t.id,
    gNumber: t.gNumber,
    serialNumber: t.serialNumber,
    ratingKva: t.ratingKva,
    status: t.status,
    manufacturerName: t.manufacturer.name,
    whereNow: t.currentStore?.name ?? t.currentSiteName ?? "Location not recorded",
    heldByStoreId: t.currentStore?.id ?? null,
    heldByStoreName: t.currentStore?.name ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-16">
      <div>
        <Link href="/store/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Store
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Move stock</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Every transformer in the system is listed. Ones you cannot move right now are greyed with
          the reason on the row, so an empty selection is never a mystery.
        </p>
      </div>

      {allowed.length === 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Your role cannot raise any of these movements.
        </p>
      ) : (
        <TransactionForm
          units={units}
          destinations={destinations as Destination[]}
          allowed={allowed}
          heading="Movement"
          actor={{ role: user.role, storeId: user.storeId ?? null }}
        />
      )}
    </div>
  );
}
