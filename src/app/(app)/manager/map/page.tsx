import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FilterableMap, type MapRow } from "@/components/manager/FilterableMap";
import { toMapPoints } from "@/lib/map-points";
import { computeWarranty } from "@/lib/warranty";
import { regionWhere } from "@/lib/region-scope";
import { findArea, NAIROBI_AREAS } from "@/lib/areas";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

export default async function ManagerMapPage() {
  const user = await requireRole("MANAGER", "ADMIN");
  const scope = regionWhere(user.region, user.role);

  const transformers = await prisma.transformer.findMany({
    where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
    include: {
      manufacturer: { select: { name: true } },
      emdisHourly: { orderBy: { hourStart: "desc" }, take: 1 },
      emdisDatasets: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });

  // toMapPoints() carries the position provenance and popup fields; the filter
  // bar needs a few more of its own on top.
  const points = toMapPoints(transformers);
  const byId = new Map(transformers.map((t) => [t.id, t]));
  const rows: MapRow[] = points.map((p) => {
    const tx = byId.get(p.id)!;
    return {
      ...p,
      manufacturer: tx.manufacturer.name,
      warrantyState: computeWarranty(tx.warrantyStart, tx.warrantyMonths).state,
      area: findArea(tx.currentSiteName, tx.substationName, tx.feeder),
    };
  });

  const manufacturers = [...new Set(rows.map((r) => r.manufacturer).filter((m): m is string => !!m))].sort();
  const areasPresent = NAIROBI_AREAS.filter((a) => rows.some((r) => r.area === a));

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
      <FilterableMap rows={rows} manufacturers={manufacturers} areas={areasPresent} />
    </div>
  );
}
