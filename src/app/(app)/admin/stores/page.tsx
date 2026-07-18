import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StoresManager, type AdminStore } from "@/components/admin/StoresManager";

export const metadata: Metadata = { title: "Stores" };
export const dynamic = "force-dynamic";

export default async function AdminStoresPage() {
  await requireRole("ADMIN");

  const stores = await prisma.store.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { transformers: true } } },
  });

  const rows: AdminStore[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    region: s.region,
    county: s.county,
    transformerCount: s._count.transformers,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Stores</h1>
        <p className="mt-1 text-sm text-ink-soft">KPLC warehouses that receive and dispatch.</p>
      </div>
      <StoresManager stores={rows} />
    </div>
  );
}
