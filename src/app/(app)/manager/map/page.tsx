import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FilterableMap, type MapRow } from "@/components/manager/FilterableMap";
import { computeWarranty } from "@/lib/warranty";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

export default async function ManagerMapPage() {
  const user = await requireRole("MANAGER", "ADMIN");
  const scope = user.role === "MANAGER" && user.region ? { region: user.region } : {};

  const transformers = await prisma.transformer.findMany({
    where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
    include: { manufacturer: { select: { name: true } } },
  });

  const rows: MapRow[] = transformers.map((tx) => ({
    id: tx.id,
    gNumber: tx.gNumber,
    serialNumber: tx.serialNumber,
    ratingKva: tx.ratingKva,
    status: tx.status,
    lat: tx.currentLat!,
    lng: tx.currentLng!,
    siteName: tx.currentSiteName,
    feeder: tx.feeder,
    manufacturer: tx.manufacturer.name,
    warrantyState: computeWarranty(tx.warrantyStart, tx.warrantyMonths).state,
  }));

  const manufacturers = [...new Set(rows.map((r) => r.manufacturer))].sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/manager/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Field map</h1>
        </div>
      </div>
      <FilterableMap rows={rows} manufacturers={manufacturers} />
    </div>
  );
}
