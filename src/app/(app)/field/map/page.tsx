import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TransformerMap, type MapPoint } from "@/components/map/TransformerMap";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Map" };
export const dynamic = "force-dynamic";

export default async function FieldMapPage() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");

  const transformers = await prisma.transformer.findMany({
    where: {
      ...(user.region ? { region: user.region } : {}),
      currentLat: { not: null },
      currentLng: { not: null },
    },
    select: {
      id: true, gNumber: true, serialNumber: true, ratingKva: true,
      status: true, currentLat: true, currentLng: true, currentSiteName: true, feeder: true,
    },
  });

  const points: MapPoint[] = transformers.map((tx) => ({
    id: tx.id,
    gNumber: tx.gNumber,
    serialNumber: tx.serialNumber,
    ratingKva: tx.ratingKva,
    status: tx.status,
    lat: tx.currentLat!,
    lng: tx.currentLng!,
    siteName: tx.currentSiteName,
    feeder: tx.feeder,
  }));

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
