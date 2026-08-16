import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Where a scanned QR code lands.
 *
 * Deliberately outside the (app) group and deliberately dumb: look the G-Number
 * up, redirect to the story page. The story page does the authenticating, so an
 * unauthenticated scan produces a sign-in screen rather than a leak, and a
 * signed-in scan goes straight to the asset.
 *
 * Short path (/t/G-2026-00042) because a shorter string is a less dense QR
 * code, and a less dense code survives being printed small and stuck on a
 * transformer that lives outdoors.
 */
export default async function QrLandingPage({
  params,
}: {
  params: Promise<{ gnumber: string }>;
}) {
  const { gnumber } = await params;
  const gNumber = decodeURIComponent(gnumber).toUpperCase();

  const t = await prisma.transformer.findFirst({
    where: { gNumber: { equals: gNumber, mode: "insensitive" } },
    select: { id: true },
  });
  if (!t) notFound();

  redirect(`/transformers/${t.id}`);
}
