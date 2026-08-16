import "server-only";
import { prisma } from "./prisma";
import { formatRating } from "./format";
import { inRegion } from "./region-scope";

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
  // limited to their patch. Matching is on the BASE region, case-insensitively,
  // so an account set to "Nairobi North" still reaches a "NAIROBI" transformer —
  // the same tolerant rule the dashboards use. Without this, every promoted
  // unit 404s the moment an engineer taps "Inspect", which is exactly what a
  // strict "NAIROBI" !== "Nairobi North" comparison was doing.
  //
  // A unit still in transit may have no region yet; inRegion() treats a null
  // transformer region as out of scope, so allow that case explicitly.
  if (!tx) return null;
  if (region && tx.region && !inRegion(tx.region, region)) return null;

  return {
    id: tx.id,
    gNumber: tx.gNumber,
    serialNumber: tx.serialNumber,
    status: tx.status,
    ratingKva: tx.ratingKva,
    currentSiteName: tx.currentSiteName,
    manufacturerName: tx.manufacturer.name,
    // Sampling policy: batchId set AND not in the tested sample means this unit
    // was never proved. Every field screen that could energise it says so.
    batchId: tx.batchId,
    sampleTested: tx.sampleTested,
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
