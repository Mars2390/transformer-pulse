import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { loadFieldTransformer } from "@/lib/field-load";
import { InspectForm } from "@/components/field/InspectForm";

export const dynamic = "force-dynamic";

export default async function InspectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");
  const { id } = await params;
  const tx = await loadFieldTransformer(id, user.region);
  if (!tx) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/field/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">← My work</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">Routine inspection</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {tx.currentSiteName ? `At ${tx.currentSiteName}.` : ""} Record condition and readings.
      </p>
      <div className="mt-6">
        <InspectForm transformerId={tx.id} gNumber={tx.gNumber} serialNumber={tx.serialNumber} detail={tx.detail} />
      </div>
    </div>
  );
}
