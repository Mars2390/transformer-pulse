import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FilterableMap, type MapRow } from "@/components/manager/FilterableMap";
import { toMapPoints } from "@/lib/map-points";
import { computeWarranty } from "@/lib/warranty";
import { regionWhere } from "@/lib/region-scope";
import { areaTextFor, findArea, NAIROBI_AREAS } from "@/lib/areas";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

export default async function ManagerMapPage() {
  const user = await requireRole("MANAGER", "ADMIN");
  const scope = regionWhere(user.region, user.role);

  const [transformers, unplacedCount] = await Promise.all([
    prisma.transformer.findMany({
      where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
      include: {
        manufacturer: { select: { name: true } },
        emdisHourly: { orderBy: { hourStart: "desc" }, take: 1 },
        emdisDatasets: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
      },
    }),
    // Counted, never fetched — these cannot be drawn. A map that does not say
    // how many it left out reads as a complete fleet.
    prisma.transformer.count({
      where: { ...scope, OR: [{ currentLat: null }, { currentLng: null }] },
    }),
  ]);

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
      areaText: areaTextFor(tx),
    };
  });

  const manufacturers = [...new Set(rows.map((r) => r.manufacturer).filter((m): m is string => !!m))].sort();
  // Offer an area if any record's location text mentions it — not only if the
  // single-bucket findArea() happened to land on it. A site reading
  // "Parklands / Westlands" belongs in both dropdowns, not just the first.
  const areasPresent = NAIROBI_AREAS.filter((a) =>
    rows.some((r) => (r.areaText ?? "").toLowerCase().includes(a.toLowerCase())),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Field map</h1>
        </div>
      </div>
      <FilterableMap
        rows={rows}
        manufacturers={manufacturers}
        areas={areasPresent}
        unplacedCount={unplacedCount}
      />
    </div>
  );
}
