import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFieldTransformer } from "@/lib/field-load";
import { ReplaceForm } from "@/components/field/ReplaceForm";
import { regionWhere } from "@/lib/region-scope";

export const dynamic = "force-dynamic";

export default async function ReplacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");
  const { id } = await params;
  const tx = await loadFieldTransformer(id, user.region);
  if (!tx) notFound();

  // Candidates: units in this region that are ready to install — received on
  // site (in transit with a RECEIVED_BY_FIELD as their last event) or still on
  // the way. We surface those on site first.
  const candidates = await prisma.transformer.findMany({
    where: {
      status: "IN_TRANSIT",
      ...regionWhere(user.region, user.role),
      id: { not: tx.id },
    },
    select: { id: true, gNumber: true, serialNumber: true, ratingKva: true },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/field/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">← My work</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">Replace transformer</h1>
      <p className="mt-1 text-sm text-ink-soft">Recover the faulty unit and install its replacement in one step.</p>
      <div className="mt-6">
        <ReplaceForm
          oldId={tx.id}
          oldLabel={tx.gNumber ?? tx.serialNumber}
          oldSite={tx.currentSiteName}
          candidates={candidates}
        />
      </div>
    </div>
  );
}
