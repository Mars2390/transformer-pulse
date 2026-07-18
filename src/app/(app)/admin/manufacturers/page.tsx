import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ManufacturersManager, type AdminManufacturer } from "@/components/admin/ManufacturersManager";

export const metadata: Metadata = { title: "Manufacturers" };
export const dynamic = "force-dynamic";

export default async function AdminManufacturersPage() {
  await requireRole("ADMIN");

  const manufacturers = await prisma.manufacturer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { transformers: true, claims: true } } },
  });

  const rows: AdminManufacturer[] = manufacturers.map((m) => ({
    id: m.id,
    name: m.name,
    country: m.country,
    warrantyMonths: m.warrantyMonths,
    contactEmail: m.contactEmail,
    contactPhone: m.contactPhone,
    contactName: m.contactName,
    transformerCount: m._count.transformers,
    claimCount: m._count.claims,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Manufacturers</h1>
        <p className="mt-1 text-sm text-ink-soft">Suppliers and their warranty terms.</p>
      </div>
      <ManufacturersManager manufacturers={rows} />
    </div>
  );
}
