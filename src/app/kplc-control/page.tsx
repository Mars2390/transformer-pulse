import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { ControlRoom } from "@/components/control/ControlRoom";

export const metadata: Metadata = { title: "Control Centre" };
export const dynamic = "force-dynamic";

/**
 * Deliberately outside the (app) route group: the control centre owns the whole
 * viewport. The light application header sitting above a dark control room
 * would break the illusion and waste the top of a projector screen.
 */
export default async function ControlCentrePage() {
  await requireRole("MANAGER", "ADMIN");
  return <ControlRoom />;
}
