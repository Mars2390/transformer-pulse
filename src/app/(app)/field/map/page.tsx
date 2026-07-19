import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { MAP_POINT_SELECT, toMapPoints } from "@/lib/map-points";
import { EmptyState } from "@/components/ui";
import { regionWhere } from "@/lib/region-scope";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

export default async function FieldMapPage() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");

  const transformers = await prisma.transformer.findMany({
    where: {
      ...regionWhere(user.region, user.role),
      currentLat: { not: null },
      currentLng: { not: null },
    },
    select: MAP_POINT_SELECT,
  });

  const points: MapPoint[] = toMapPoints(transformers);

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

      <div className="overflow-hidden rounded-2xl border border-line">
        {points.length ? (
          <div className="h-[70vh]">
            <TransformerMap points={points} height="70vh" zoom={10} />
          </div>
        ) : (
          <EmptyState message="No transformers with a recorded location in your region yet." />
        )}
      </div>
    </div>
  );
}
