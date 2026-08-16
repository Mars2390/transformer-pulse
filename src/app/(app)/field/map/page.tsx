import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FilterableMap, type MapRow } from "@/components/manager/FilterableMap";
import { MAP_POINT_SELECT, toMapPoints } from "@/lib/map-points";
import { EmptyState } from "@/components/ui";
import { regionWhere } from "@/lib/region-scope";
import { areaTextFor, findArea, NAIROBI_AREAS } from "@/lib/areas";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

export default async function FieldMapPage() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");

  const scope = regionWhere(user.region, user.role);

  const [transformers, unplacedCount] = await Promise.all([
    prisma.transformer.findMany({
      where: { ...scope, currentLat: { not: null }, currentLng: { not: null } },
      select: MAP_POINT_SELECT,
    }),
    // Counted, never fetched — these cannot be drawn. A map that does not say
    // how many it left out reads as a complete fleet.
    prisma.transformer.count({
      where: { ...scope, OR: [{ currentLat: null }, { currentLng: null }] },
    }),
  ]);

  const points = toMapPoints(transformers);
  const byId = new Map(transformers.map((t) => [t.id, t]));
  const rows: MapRow[] = points.map((p) => {
    const tx = byId.get(p.id)!;
    return {
      ...p,
      area: findArea(tx.currentSiteName, tx.substationName, tx.feeder),
      areaText: areaTextFor(tx),
    };
  });
  // Offer an area if any record's location text mentions it — not only if the
  // single-bucket findArea() happened to land on it.
  const areasPresent = NAIROBI_AREAS.filter((a) =>
    rows.some((r) => (r.areaText ?? "").toLowerCase().includes(a.toLowerCase())),
  );

  return (
    <div className="pb-20">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy">Map</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {user.region ?? "All regions"} · {points.length} located
          </p>
        </div>
        <Link href="/field/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← My work
        </Link>
      </div>

      {points.length ? (
        <FilterableMap
          rows={rows}
          areas={areasPresent}
          showManufacturerWarranty={false}
          unplacedCount={unplacedCount}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <EmptyState message="No transformers with a recorded location in your region yet." />
        </div>
      )}
    </div>
  );
}
