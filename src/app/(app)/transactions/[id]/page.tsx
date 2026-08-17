import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, Badge } from "@/components/ui";
import { LegActions } from "@/components/transactions/LegActions";
import { LIFECYCLE_RULES } from "@/lib/lifecycle";
import { MOVEMENTS, TRANSACTION_STATUS_META, type MovementKey, type TransactionStatus } from "@/lib/transactions";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Movement" };
export const dynamic = "force-dynamic";

/** One journey, end to end: who asked, who approved, when it left, when it landed. */
export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const r = await prisma.transactionRecord.findUnique({
    where: { id },
    include: {
      transformer: { select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, status: true } },
      initiatedBy: { select: { name: true, role: true } },
      approvedBy: { select: { name: true, role: true } },
      receivedBy: { select: { name: true, role: true } },
      presentEngineer: { select: { name: true } },
      presenceConfirmedBy: { select: { name: true } },
    },
  });
  if (!r) notFound();

  const movement = MOVEMENTS[r.movement as MovementKey];
  const meta = TRANSACTION_STATUS_META[r.status as TransactionStatus] ?? { label: r.status, tone: "neutral" as const };
  const rule = movement ? LIFECYCLE_RULES[movement.completionEvent] : null;
  const needsEvidence = Boolean(rule?.requires.gps || rule?.requires.photo);
  const label = r.transformer.gNumber ?? r.transformer.serialNumber;

  const steps = [
    { name: "Raised", who: r.initiatedBy.name, at: r.initiatedAt },
    { name: r.status === "REJECTED" ? "Refused" : "Approved", who: r.approvedBy?.name ?? null, at: r.approvedAt },
    { name: "Departed", who: null, at: r.departedAt },
    { name: "Arrived", who: r.receivedBy?.name ?? null, at: r.arrivedAt },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/manager/transactions" className="text-xs font-bold text-ink-soft hover:text-kplc">
        ← All movements
      </Link>

      <div className="rounded-2xl border border-line bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {r.batchRef && <span className="text-xs font-bold text-ink-soft">{r.batchRef}</span>}
        </div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">
          {r.fromName} → {r.toName}
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {movement?.label ?? r.movement} · {r.purpose.toLowerCase()} ·{" "}
          <Link href={`/transformers/${r.transformer.id}`} className="font-bold text-kplc hover:underline">
            {label}
          </Link>
        </p>
        {(r.vehiclePlate || r.driverName) && (
          <p className="mt-1 text-sm text-ink-soft">
            {r.vehiclePlate ? `Vehicle ${r.vehiclePlate}` : ""}
            {r.driverName ? ` · ${r.driverName}` : ""}
            {r.driverPhone ? ` · ${r.driverPhone}` : ""}
          </p>
        )}
        {r.rejectionReason && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            Refused: {r.rejectionReason}
          </p>
        )}
        {r.notes && <p className="mt-3 text-sm text-ink">{r.notes}</p>}
      </div>

      <Card>
        <CardHeader title="Journey" />
        <ol className="divide-y divide-line">
          {steps.map((s) => (
            <li key={s.name} className="flex items-center gap-4 px-5 py-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.at ? "bg-emerald-500" : "bg-slate-300"}`}
              />
              <span className="flex-1 text-sm font-semibold text-navy">{s.name}</span>
              <span className="text-xs text-ink-soft">
                {s.at ? `${s.who ? `${s.who} · ` : ""}${formatRelative(s.at)}` : "—"}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader title="What happens next" />
        <div className="p-4">
          <LegActions
            transactionId={r.id}
            status={r.status}
            needsEvidence={needsEvidence}
            toName={r.toName}
            presence={
              movement && movement.from === "SITE"
                ? {
                    engineerName: r.presentEngineer?.name ?? null,
                    confirmedAt: r.presenceConfirmedAt?.toISOString() ?? null,
                    confirmedByName: r.presenceConfirmedBy?.name ?? null,
                  }
                : null
            }
          />
        </div>
      </Card>
    </div>
  );
}
