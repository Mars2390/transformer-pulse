import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OnboardExisting } from "@/components/store/OnboardExisting";

export const metadata: Metadata = { title: "Onboard existing transformer" };
export const dynamic = "force-dynamic";

/**
 * Deliberately OUTSIDE the (app) route group.
 *
 * The split map/form view needs the whole viewport — the app chrome's sidebar
 * and header would leave the map about 400 px wide on a laptop, which is
 * useless for dropping an accurate pin.
 */
export default async function OnboardPage() {
  const user = await requireRole("STORE_KEEPER", "ADMIN");

  const year = new Date().getFullYear();
  const [manufacturers, existing, latest] = await Promise.all([
    prisma.manufacturer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    // Everything already pinned, so the keeper can see what is taken and does
    // not onboard the same pole twice.
    prisma.transformer.findMany({
      where: { currentLat: { not: null }, currentLng: { not: null } },
      select: { id: true, gNumber: true, currentLat: true, currentLng: true },
      take: 2000,
    }),
    prisma.transformer.findFirst({
      where: { gNumber: { startsWith: `G-${year}-` } },
      orderBy: { gNumber: "desc" },
      select: { gNumber: true },
    }),
  ]);

  const last = latest?.gNumber ? Number(latest.gNumber.split("-")[2] ?? 0) : 0;
  const suggested = `G-${year}-${String(last + 1).padStart(5, "0")}`;

  return (
    <OnboardExisting
      manufacturers={manufacturers}
      existing={existing.map((t) => ({
        id: t.id,
        gNumber: t.gNumber,
        lat: t.currentLat!,
        lng: t.currentLng!,
      }))}
      keeperName={user.name}
      suggestedGNumber={suggested}
      region={user.region}
    />
  );
}
