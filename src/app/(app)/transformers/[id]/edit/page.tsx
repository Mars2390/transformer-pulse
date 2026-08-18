import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EditTransformerForm, type EditDefaults } from "@/components/store/EditTransformerForm";

export const metadata: Metadata = { title: "Edit nameplate" };
export const dynamic = "force-dynamic";

export default async function EditTransformerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("STORE_KEEPER", "ADMIN");
  const { id } = await params;

  const tx = await prisma.transformer.findUnique({ where: { id } });
  if (!tx) notFound();

  const defaults: EditDefaults = {
    ratingKva: tx.ratingKva,
    primaryKv: tx.primaryKv,
    secondaryKv: tx.secondaryKv,
    phases: tx.phases,
    coolingType: tx.coolingType,
    impedancePct: tx.impedancePct,
    vectorGroup: tx.vectorGroup,
    oilVolumeLitres: tx.oilVolumeLitres,
    yearOfManufacture: tx.yearOfManufacture,
    frequencyHz: tx.frequencyHz,
    duty: tx.duty,
    standardRef: tx.standardRef,
    hvInsulationLevelKv: tx.hvInsulationLevelKv,
    tempRiseOilC: tx.tempRiseOilC,
    tempRiseWindingC: tx.tempRiseWindingC,
    tempClass: tx.tempClass,
    maxAmbientTempC: tx.maxAmbientTempC,
    insulationOilType: tx.insulationOilType,
    oilWeightKg: tx.oilWeightKg,
    totalWeightKg: tx.totalWeightKg,
    tapRange: tx.tapRange,
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/transformers/${id}`} className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft transition-colors hover:text-kplc">
        ← Back to story
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">Edit nameplate</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Complete or correct the details read from the physical plate.
      </p>
      <div className="mt-6">
        <EditTransformerForm transformerId={tx.id} label={tx.gNumber ?? tx.serialNumber} defaults={defaults} />
      </div>
    </div>
  );
}
