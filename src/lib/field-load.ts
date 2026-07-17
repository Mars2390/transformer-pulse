import "server-only";
import { prisma } from "./prisma";
import { formatRating } from "./format";

/**
 * Loads a transformer for a field action and builds its header line. Returns
 * null if it does not exist or is outside the engineer's region — a field
 * engineer only ever acts on their own patch.
 */
export async function loadFieldTransformer(id: string, region: string | null) {
  const tx = await prisma.transformer.findUnique({
    where: { id },
    include: {
      manufacturer: { select: { name: true } },
      events: {
        orderBy: { occurredAt: "desc" },
        take: 1,
        select: { type: true, destination: true, vehiclePlate: true, driverName: true },
      },
    },
  });

  // Region scoping. An admin (region null) sees everything; an engineer is
  // limited to theirs. A unit still in transit may not have a region yet, so
  // allow it when the region is unset.
  if (!tx) return null;
  if (region && tx.region && tx.region !== region) return null;

  return {
    id: tx.id,
    gNumber: tx.gNumber,
    serialNumber: tx.serialNumber,
    status: tx.status,
    ratingKva: tx.ratingKva,
    currentSiteName: tx.currentSiteName,
    manufacturerName: tx.manufacturer.name,
    lastEventType: tx.events[0]?.type ?? null,
    detail: `${formatRating(tx.ratingKva)} · ${tx.manufacturer.name}`,
    dispatch: tx.events[0]
      ? [
          tx.events[0].destination ? `To ${tx.events[0].destination}` : null,
          tx.events[0].vehiclePlate ? `Vehicle ${tx.events[0].vehiclePlate}` : null,
          tx.events[0].driverName ? `Driver ${tx.events[0].driverName}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null
      : null,
  };
}
