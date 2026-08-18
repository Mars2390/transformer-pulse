import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MeterDataUploader } from "@/components/control/MeterDataUploader";

export const metadata: Metadata = { title: "Meter data" };
export const dynamic = "force-dynamic";

export default async function MeterDataPage() {
  const user = await requireRole("ADMIN", "MANAGER");

  const dataset = await prisma.meterDataset.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href={user.role === "ADMIN" ? "/admin/dashboard" : "/manager/dashboard"}
          className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft transition-colors hover:text-kplc"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Meter data management</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Smart-meter interval data for the control centre&apos;s live monitoring
          demonstration.
        </p>
      </div>

      <MeterDataUploader
        existing={
          dataset
            ? {
                id: dataset.id,
                name: dataset.name,
                meterCount: dataset.meterCount,
                intervalCount: dataset.intervalCount,
                ratingKva: dataset.ratingKva,
                transformerRef: dataset.transformerRef,
                uploadedByName: dataset.uploadedByName,
                createdAtISO: dataset.createdAt.toISOString(),
              }
            : null
        }
      />
    </div>
  );
}
