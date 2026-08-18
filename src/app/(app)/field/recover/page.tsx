import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TransactionForm, type MovableUnit, type Destination } from "@/components/transactions/TransactionForm";
import { movementsFor } from "@/lib/transactions";
import { regionWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Recover a transformer" };
export const dynamic = "force-dynamic";

/**
 * A field engineer taking a unit off a pole, or condemning it where it stands.
 *
 * The engineer raises it; a manager authorises it. That split is the point —
 * recovering a unit takes a site off supply, and the person who decides that
 * should not be the only person who knows.
 */
export default async function FieldRecoverPage() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");

  const allowed = movementsFor(user.role).map((m) => m.key);

  const [inField, destinations, engineerRows] = await Promise.all([
    prisma.transformer.findMany({
      // Everything in region, whatever its status. Reasons are shown per row.
      where: regionWhere(user.region, user.role),
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
      where: { active: true },
      select: { id: true, name: true, kind: true, region: true },
      orderBy: { name: "asc" },
    }),
    // Every active field engineer. All three movements a field engineer may
    // raise start at a site, and site-origin movements now require a NAMED
    // engineer present at the pole — so without this list the picker renders
    // against [] and the form can never be submitted.
    //
    // Deliberately NOT filtered by region, matching /store/transfer: the
    // engineer standing at the pole is not always the one whose region owns it,
    // and silently hiding them is worse than a longer list.
    prisma.user.findMany({
      where: { role: "FIELD_ENGINEER", active: true },
      select: {
        id: true,
        name: true,
        email: true,
        region: true,
        _count: { select: { assignedTransformers: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const units: MovableUnit[] = inField.map((t) => ({
    id: t.id,
    gNumber: t.gNumber,
    serialNumber: t.serialNumber,
    ratingKva: t.ratingKva,
    status: t.status,
    manufacturerName: t.manufacturer.name,
    whereNow: t.currentSiteName ?? t.currentStore?.name ?? "Location not recorded",
    heldByStoreId: t.currentStore?.id ?? null,
    heldByStoreName: t.currentStore?.name ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24">
      <div>
        <Link href="/field/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← My work
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Recover a transformer</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Taking a unit off a pole, or writing one off where it stands. A manager approves before it moves.
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
          heading="Recovery"
          // actor.id matters here: it is what lets the picker mark the
          // signed-in engineer as "(you)" and preselect them, which is the
          // overwhelmingly common case on this screen.
          actor={{ role: user.role, storeId: user.storeId ?? null, id: user.id }}
          engineers={engineerRows.map((e) => ({
            id: e.id,
            name: e.name,
            email: e.email,
            region: e.region,
            activeTasks: e._count.assignedTransformers,
          }))}
        />
      )}
    </div>
  );
}
