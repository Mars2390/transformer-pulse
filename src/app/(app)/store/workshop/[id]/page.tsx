import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RepairForm } from "@/components/store/RepairForm";
import { TechnicianAssign } from "@/components/store/TechnicianAssign";
import { listTechnicians } from "@/lib/workshop";

export const metadata: Metadata = { title: "Record repair outcome" };
export const dynamic = "force-dynamic";

export default async function RepairPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("STORE_KEEPER", "STORE_MANAGER", "ADMIN");
  const { id } = await params;

  const repair = await prisma.repairRecord.findUnique({
    where: { id },
    include: {
      technician: { select: { id: true, name: true } },
      workshopStore: { select: { id: true, name: true } },
      transformer: {
        select: {
          id: true, gNumber: true, serialNumber: true, ratingKva: true,
          currentSiteName: true, repairCount: true,
          manufacturer: { select: { name: true } },
        },
      },
    },
  });
  if (!repair) notFound();

  const t = repair.transformer;
  const technicians = await listTechnicians(repair.workshopStoreId);
  const started = repair.status === "IN_REPAIR";

  // A closed repair is history, not a form. Re-opening it to "correct" an
  // outcome would rewrite what the workshop said, and the chain event is
  // already written against it.
  if (repair.repairCompletedAt) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Link href="/store/workshop" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Workshop
        </Link>
        <div className="rounded-2xl border border-line bg-white p-6">
          <p className="text-sm font-bold text-navy">This repair is already closed</p>
          <p className="mt-2 text-sm text-ink-soft">
            {t.gNumber ? `G-${t.gNumber}` : t.serialNumber} was recorded as{" "}
            <strong className={repair.repairSuccessful ? "text-kplc" : "text-red-700"}>
              {repair.repairSuccessful ? "repaired" : "beyond repair"}
            </strong>{" "}
            on {repair.repairCompletedAt.toISOString().slice(0, 10)}.
          </p>
          <p className="mt-2 text-xs text-ink-soft">
            The outcome is on the transformer&apos;s chain and is not editable. If it was wrong,
            record what actually happened as a new event rather than changing this one.
          </p>
          <Link
            href={`/transformers/${t.id}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-kplc px-4 text-xs font-bold text-white"
          >
            View full story
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <Link href="/store/workshop" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Workshop
        </Link>
        <h1 className="mt-2 text-xl font-extrabold tracking-tight text-navy">
          Record repair outcome
        </h1>
      </div>

      {/* --- Who is doing the work ---------------------------------------- */}
      <div className="rounded-2xl border border-line bg-white p-5">
        <TechnicianAssign
          repairId={repair.id}
          assignedId={repair.technicianId}
          started={started}
          technicians={technicians.map((tech) => ({
            id: tech.id,
            name: tech.name,
            available: tech.available,
            activeJobs: tech.activeJobs,
            currentJobLabel: tech.currentJob?.label ?? null,
          }))}
        />
      </div>

      {started ? (
        <RepairForm
        repairId={repair.id}
        transformer={{
          id: t.id,
          label: t.gNumber ? `G-${t.gNumber}` : t.serialNumber,
          ratingKva: t.ratingKva,
          make: t.manufacturer.name,
          siteName: t.currentSiteName,
          repairCount: t.repairCount,
          reportedFault: repair.faultCauseReported,
          daysOnBench: Math.floor((Date.now() - repair.receivedAtWorkshop.getTime()) / 86_400_000),
        }}
      />
      ) : (
        <p className="rounded-2xl border border-line bg-surface-2 px-4 py-4 text-xs text-ink-soft">
          The outcome form appears once work has started. An outcome recorded against a job nobody
          opened is a repair with no named hands on it, and the confirmed fault cause — the most
          useful field in this record — would have nobody standing behind it.
        </p>
      )}
    </div>
  );
}
