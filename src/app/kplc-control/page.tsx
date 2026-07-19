import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { EmdisControlRoom } from "@/components/control/EmdisControlRoom";

export const metadata: Metadata = { title: "Control Centre" };
export const dynamic = "force-dynamic";

/**
 * Deliberately outside the (app) route group: the control centre owns the whole
 * viewport. The light application header sitting above a dark control room
 * would break the illusion and waste the top of a projector screen.
 *
 * Driven by KPLC's own EMDis telemetry — three-phase, one minute at a time,
 * analysed against the transformer's nameplate by the same engine that writes
 * the reports. The room and the paperwork can never disagree.
 */
export default async function ControlCentrePage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string }>;
}) {
  await requireRole("MANAGER", "ADMIN");
  const { dataset } = await searchParams;
  return <EmdisControlRoom datasetId={dataset} />;
}
