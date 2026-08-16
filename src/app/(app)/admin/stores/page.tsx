import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StoresManager, type AdminStore } from "@/components/admin/StoresManager";

export const metadata: Metadata = { title: "Stores" };
export const dynamic = "force-dynamic";

export default async function AdminStoresPage() {
  await requireRole("ADMIN");

  const stores = await prisma.store.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { transformers: true } },
      users: {
        select: { id: true, name: true, email: true, role: true, active: true },
        orderBy: { name: "asc" },
      },
    },
  });

  // Movement counts decide whether a store can ever be deleted, so they are
  // fetched once here rather than discovered when the delete button fails.
  const movementCounts = await prisma.transactionRecord.groupBy({
    by: ["fromId"],
    _count: { _all: true },
    where: { fromId: { not: null } },
  });
  const movementsByStore = new Map(movementCounts.map((m) => [m.fromId, m._count._all]));

  const rows: AdminStore[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    region: s.region,
    county: s.county,
    kind: s.kind,
    active: s.active,
    transformerCount: s._count.transformers,
    movementCount: movementsByStore.get(s.id) ?? 0,
    users: s.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
    })),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Stores</h1>
        <p className="mt-1 text-sm text-ink-soft">
          KPLC warehouses and workshops. A workshop is a store whose kind is WORKSHOP — it receives,
          holds and dispatches exactly the same way, which is why it is one column rather than a
          second table.
        </p>
      </div>
      <StoresManager stores={rows} />
    </div>
  );
}
