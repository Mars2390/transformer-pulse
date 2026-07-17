import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { loadFieldTransformer } from "@/lib/field-load";
import { InstallForm } from "@/components/field/InstallForm";

export const dynamic = "force-dynamic";

export default async function InstallPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");
  const { id } = await params;
  const tx = await loadFieldTransformer(id, user.region);
  if (!tx) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/field/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">← My work</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">Install transformer</h1>
      <p className="mt-1 text-sm text-ink-soft">Photo, GPS and commissioning test. This puts it on the map.</p>
      <div className="mt-6">
        <InstallForm
          transformerId={tx.id}
          gNumber={tx.gNumber}
          serialNumber={tx.serialNumber}
          detail={tx.detail}
          suggestedSite={tx.currentSiteName}
        />
      </div>
    </div>
  );
}
