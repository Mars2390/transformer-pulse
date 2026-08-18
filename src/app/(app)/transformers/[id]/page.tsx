import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyChain, type ChainLink } from "@/lib/chain";
import { computeWarranty } from "@/lib/warranty";
import { computeHealth, HEALTH_BAND_META } from "@/lib/health";
import { buildPriorityList } from "@/lib/combined-health";
import { deriveHealthStatus, HEALTH_STATUS_META } from "@/lib/health-status";
import { computeServiceSummary } from "@/lib/service-summary";
import { measured, unit, pair } from "@/lib/measure";
import { APPROVAL_ACTION_META, APPROVAL_STATUS_META, isApprovalAction, type ApprovalAction, type ApprovalStatus } from "@/lib/approvals";
import { Badge } from "@/components/ui";
import { StoryLocationMap } from "@/components/transformer/StoryLocationMap";
import { StoryTabs } from "@/components/transformer/StoryTabs";
import {
  MOVEMENTS,
  TRANSACTION_STATUS_META,
  type MovementKey,
  type TransactionStatus,
} from "@/lib/transactions";
import { ServiceSummaryCard } from "@/components/transformer/ServiceSummaryCard";
import { LinkStatusBanner } from "@/components/transformer/LinkStatusBanner";
import type { WarrantyView } from "@/components/transformer/WarrantyTab";
import type { StoryData, StoryEvent, StoryTest } from "@/components/transformer/story-types";
import { STATUS_META, formatRating, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tx = await prisma.transformer.findUnique({
    where: { id },
    select: { gNumber: true, serialNumber: true },
  });
  return { title: tx ? (tx.gNumber ?? tx.serialNumber) : "Transformer" };
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireUser();
  const canEditNameplate = viewer.role === "STORE_KEEPER" || viewer.role === "ADMIN";
  const { id } = await params;

  const tx = await prisma.transformer.findUnique({
    where: { id },
    include: {
      manufacturer: { select: { name: true } },
      fatReportUploadedBy: { select: { name: true } },
      events: {
        orderBy: { occurredAt: "desc" },
        include: {
          user: { select: { name: true, role: true } },
          tests: true,
        },
      },
      tests: { orderBy: { testedAt: "desc" }, include: { testedBy: { select: { name: true } } } },
      claims: { include: { manufacturer: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      repairs: { orderBy: { receivedAtWorkshop: "desc" } },
    },
  });

  if (!tx) notFound();

  const [emdisAgg, inspectionCount, movements, priorityRows, approvalDocs] = await Promise.all([
    prisma.emdisDataset.aggregate({
      where: { transformerId: id },
      _sum: { readingCount: true },
    }),
    prisma.substationInspection.count({ where: { transformerId: id } }),
    prisma.transactionRecord.findMany({
      where: { transformerId: id },
      orderBy: { initiatedAt: "desc" },
      take: 20,
      include: {
        initiatedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        receivedBy: { select: { name: true } },
      },
    }),
    buildPriorityList({ transformerIds: [id], allStatuses: true }),
    // Every approval ever raised against this unit. Newest first, because the
    // question somebody is usually answering is "what is it waiting on".
    prisma.approvalDocument.findMany({
      where: { transformerId: id },
      orderBy: { requestedAt: "desc" },
      take: 40,
      include: {
        requestedBy: { select: { name: true } },
        decidedBy: { select: { name: true } },
      },
    }),
  ]);
  const emdisReadingCount = emdisAgg._sum.readingCount ?? 0;

  const chronological = [...tx.events].reverse();
  const verification = verifyChain(chronological as unknown as ChainLink[]);

  const w = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
  const monthsUsed =
    w.state === "NOT_STARTED"
      ? 0
      : Math.max(0, tx.warrantyMonths - (w.monthsRemaining ?? 0));
  const warranty: WarrantyView = {
    state: w.state,
    startISO: tx.warrantyStart?.toISOString() ?? null,
    expiryISO: w.expiresAt?.toISOString() ?? null,
    months: tx.warrantyMonths,
    monthsUsed,
    daysRemaining: w.daysRemaining,
    claimable: w.claimable,
  };

  const latestTest = tx.tests[0] ?? null;
  const failureCount = tx.events.filter((e) => e.type === "FAULT_REPORTED").length;
  const ageYears =
    (Date.now() - new Date(tx.yearOfManufacture, 0, 1).getTime()) /
    (1000 * 60 * 60 * 24 * 365.25);
  const health = computeHealth({ latestTest, failureCount, ageYears });

  const priorityRow = priorityRows[0] ?? null;
  const healthStatus = deriveHealthStatus({
    electrical: priorityRow?.electrical ?? null,
    physical: priorityRow?.physical ?? null,
    status: tx.status,
    reasons: priorityRow?.reasons ?? [],
  });

  const serviceSummary = await computeServiceSummary({
    transformer: {
      id: tx.id, ratingKva: tx.ratingKva, secondaryKv: tx.secondaryKv,
      yearOfManufacture: tx.yearOfManufacture, commissionDate: tx.commissionDate,
    },
    events: tx.events.map((e) => ({ type: e.type, toStatus: e.toStatus, occurredAt: e.occurredAt })),
    repairs: tx.repairs.map((r) => ({
      receivedAtWorkshop: r.receivedAtWorkshop,
      repairCompletedAt: r.repairCompletedAt,
      repairCostKes: r.repairCostKes,
    })),
    testsCount: tx.tests.length,
    claimsCount: tx.claims.length,
  });

  // Dates cannot cross into a client component, and the turnaround is worth
  // computing once here rather than in three places in the table.
  const repairs = tx.repairs.map((r) => ({
    id: r.id,
    receivedAtWorkshop: r.receivedAtWorkshop.toISOString().slice(0, 10),
    repairCompletedAt: r.repairCompletedAt?.toISOString().slice(0, 10) ?? null,
    workshopName: r.workshopName,
    faultCauseReported: r.faultCauseReported,
    faultCauseConfirmed: r.faultCauseConfirmed,
    repairActions: r.repairActions,
    partsReplaced: r.partsReplaced,
    repairCostKes: r.repairCostKes,
    repairWarrantyMonths: r.repairWarrantyMonths,
    repairSuccessful: r.repairSuccessful,
    failureReason: r.failureReason,
    workshopTechnician: r.workshopTechnician,
    turnaroundDays: r.repairCompletedAt
      ? Math.round((r.repairCompletedAt.getTime() - r.receivedAtWorkshop.getTime()) / 86_400_000)
      : null,
  }));

  const events: StoryEvent[] = tx.events.map((e) => {
    const t = e.tests[0];
    return {
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      userName: e.user.name,
      userRole: e.user.role,
      occurredAt: e.occurredAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
      lat: e.lat,
      lng: e.lng,
      accuracyM: e.accuracyM,
      locationName: e.locationName,
      vehiclePlate: e.vehiclePlate,
      driverName: e.driverName,
      driverPhone: e.driverPhone,
      destination: e.destination,
      photoUrls: e.photoUrls,
      notes: e.notes,
      hash: e.hash,
      prevHash: e.prevHash,
      test: t
        ? {
            id: t.id, stage: t.stage, passed: t.passed, testedAt: t.testedAt.toISOString(),
            insulationResistanceHvMohm: t.insulationResistanceHvMohm,
            insulationResistanceLvMohm: t.insulationResistanceLvMohm,
            turnsRatio: t.turnsRatio, turnsRatioDeviationPct: t.turnsRatioDeviationPct,
            windingResistanceHvOhm: t.windingResistanceHvOhm,
            windingResistanceLvOhm: t.windingResistanceLvOhm,
            oilBdvKv: t.oilBdvKv, oilTempC: t.oilTempC, ambientTempC: t.ambientTempC,
            polarityOk: t.polarityOk, remarks: t.remarks,
          }
        : null,
    };
  });

  const tests: StoryTest[] = tx.tests.map((t) => ({
    id: t.id, stage: t.stage, passed: t.passed, testedAt: t.testedAt.toISOString(),
    insulationResistanceHvMohm: t.insulationResistanceHvMohm,
    insulationResistanceLvMohm: t.insulationResistanceLvMohm,
    turnsRatio: t.turnsRatio, turnsRatioDeviationPct: t.turnsRatioDeviationPct,
    windingResistanceHvOhm: t.windingResistanceHvOhm,
    windingResistanceLvOhm: t.windingResistanceLvOhm,
    oilBdvKv: t.oilBdvKv, oilTempC: t.oilTempC, ambientTempC: t.ambientTempC,
    polarityOk: t.polarityOk, remarks: t.remarks,
  }));

  const story: StoryData = {
    id: tx.id,
    serialNumber: tx.serialNumber,
    gNumber: tx.gNumber,
    manufacturerName: tx.manufacturer.name,
    ratingKva: tx.ratingKva,
    primaryKv: tx.primaryKv,
    secondaryKv: tx.secondaryKv,
    phases: tx.phases,
    coolingType: tx.coolingType,
    vectorGroup: tx.vectorGroup,
    yearOfManufacture: tx.yearOfManufacture,
    status: tx.status,
    currentSiteName: tx.currentSiteName,
    feeder: tx.feeder,
    region: tx.region,
    substationCode: tx.substationCode,
    substationName: tx.substationName,
    warrantyStart: tx.warrantyStart?.toISOString() ?? null,
    warrantyMonths: tx.warrantyMonths,
    events,
    claims: tx.claims.map((c) => ({
      id: c.id, status: c.status, faultReason: c.faultReason,
      claimValueKes: c.claimValueKes ? Number(c.claimValueKes) : null,
      referenceNo: c.referenceNo, manufacturerName: c.manufacturer.name,
    })),
  };

  const healthMeta = HEALTH_BAND_META[health.band];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/transformers" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft transition-colors hover:text-kplc">
        ← All transformers
      </Link>

      {/* --- Header ------------------------------------------------------- */}
      <div className="mt-3 rounded-2xl border border-line bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">
                {story.gNumber ?? story.serialNumber}
              </h1>
              <Badge tone={STATUS_META[story.status].tone}>
                {STATUS_META[story.status].label}
              </Badge>
              <span
                className="rounded-full px-2.5 py-1 text-xs font-extrabold"
                style={{ backgroundColor: HEALTH_STATUS_META[healthStatus.level].colour + "1a", color: HEALTH_STATUS_META[healthStatus.level].colour }}
                title={healthStatus.explanation}
              >
                {HEALTH_STATUS_META[healthStatus.level].emoji} {HEALTH_STATUS_META[healthStatus.level].label.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs font-semibold text-ink-soft">
              {HEALTH_STATUS_META[healthStatus.level].label.toUpperCase()}: {healthStatus.explanation}
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              {story.gNumber && <span className="font-mono">{story.serialNumber} · </span>}
              {formatRating(story.ratingKva)} · {story.manufacturerName} · {story.yearOfManufacture}
            </p>
            {story.currentSiteName && (
              <p className="mt-0.5 text-sm text-ink-soft">
                At {story.currentSiteName}
                {story.feeder ? ` · feeder ${story.feeder}` : ""}
              </p>
            )}
            {/* --- Released untested ---------------------------------------
                batchId AND not sampleTested. A unit received on its own has
                batchId null and sampleTested false, and that is NOT an untested
                release — it went through the ordinary intake test. */}
            {tx.batchId && !tx.sampleTested && (
              <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                ⚠️ Never tested. Released under KPLC sampling policy — a sample of its consignment
                was tested and this unit was not one of them.
              </p>
            )}
            {story.substationCode && (
              <p className="mt-0.5 text-sm text-ink-soft">
                Substation{" "}
                <Link
                  href={`/substations/${encodeURIComponent(story.substationCode)}`}
                  className="font-bold text-kplc hover:underline"
                >
                  {story.substationCode}
                  {story.substationName ? ` — ${story.substationName}` : ""}
                </Link>
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {/* The tag. Opens the PNG full size, ready to print and mount. */}
              <a
                href={`/api/transformers/${id}/qr`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy transition-colors hover:border-kplc hover:text-kplc"
              >
                📱 QR code
              </a>
              <a
                href={`/api/pdf/transformer/${id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-kplc px-3 py-2 text-xs font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
              >
                Download PDF
              </a>
              <a
                href={`/api/pdf/dossier/${id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy transition-colors hover:border-kplc hover:text-kplc"
              >
                📄 Export Full Dossier
              </a>
              {canEditNameplate && (
                <Link
                  href={`/transformers/${id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy transition-colors hover:border-kplc hover:text-kplc"
                >
                  Edit nameplate
                </Link>
              )}
            </div>
          </div>

          {/* Chain badge — the claim the whole system rests on. */}
          <div
            className={`rounded-xl border px-4 py-2.5 ${
              verification.valid
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`text-xs font-bold ${
                verification.valid ? "text-emerald-800" : "text-red-800"
              }`}
            >
              {verification.valid ? "✓ Chain verified" : "✕ Chain tampered"}
            </p>
            <p className={`text-[11px] ${verification.valid ? "text-emerald-600" : "text-red-600"}`}>
              {verification.checked} events
            </p>
          </div>
        </div>

        {/* --- Vital signs ---------------------------------------------- */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">HEALTH</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-navy">{health.score}</span>
              <Badge tone={healthMeta.tone}>{healthMeta.label}</Badge>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">WARRANTY</p>
            <p className="mt-1 text-sm font-bold text-navy">
              {warranty.state === "NOT_STARTED"
                ? "Not started"
                : warranty.state === "EXPIRED"
                  ? "Expired"
                  : `${warranty.daysRemaining} days left`}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">SPEC</p>
            <p className="mt-1 text-sm font-bold text-navy">
              {story.primaryKv}/{story.secondaryKv} kV · {story.phases}ph
            </p>
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">EVENTS</p>
            <p className="mt-1 text-sm font-bold text-navy">{story.events.length}</p>
          </div>
        </div>

        {/* --- Approval paperwork ---------------------------------------- */}
        {approvalDocs.length > 0 && (
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-[11px] font-bold tracking-wide text-ink-soft">
              APPROVALS · {approvalDocs.length}
            </p>
            <p className="mt-1 text-[11px] text-ink-soft">
              A pending row downloads as a request; a decided one as an official certificate. Both
              carry the same reference, so they file together.
            </p>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {approvalDocs.filter((d) => isApprovalAction(d.action)).map((d) => {
                const meta = APPROVAL_ACTION_META[d.action as ApprovalAction];
                const statusMeta = APPROVAL_STATUS_META[d.status as ApprovalStatus] ?? {
                  label: d.status,
                  tone: "neutral" as const,
                };
                return (
                  <li key={d.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${d.emergency ? "bg-amber-50/60" : ""}`}>
                    <span className="font-mono text-[11px] font-bold text-navy">{d.reference}</span>
                    <span className="text-xs font-semibold text-ink">{meta.label}</span>
                    <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                    {d.emergency && (
                      <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                        EMERGENCY
                      </span>
                    )}
                    <span className="text-[11px] text-ink-soft">
                      {d.status === "PENDING"
                        ? `Raised by ${d.requestedBy.name} · ${formatDateTime(d.requestedAt)}`
                        : `${d.decidedBy?.name ?? "—"} · ${d.decidedAt ? formatDateTime(d.decidedAt) : "—"}`}
                    </span>
                    <a
                      href={`/api/pdf/approval/${d.id}`}
                      className="ml-auto shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-navy hover:border-kplc hover:text-kplc"
                    >
                      {d.status === "PENDING" ? "Download Approval Request PDF" : "Download Approval PDF"}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* --- Full nameplate ------------------------------------------- */}
        {(() => {
          const spec: [string, string | number | null][] = [
            ["Rating", `${tx.ratingKva} kVA`],
            ["Voltage", `${tx.primaryKv} / ${tx.secondaryKv} kV`],
            ["Vector group", tx.vectorGroup],
            ["Cooling", tx.coolingType],
            ["Impedance", measured(tx.impedancePct) != null ? `${tx.impedancePct}%` : null],
            ["Frequency", unit(tx.frequencyHz, "Hz")],
            ["Duty", tx.duty],
            ["Standard", tx.standardRef],
            ["HV insulation / BIL", tx.hvInsulationLevelKv],
            ["Temp rise oil/wdg", pair(tx.tempRiseOilC, tx.tempRiseWindingC, "°C")],
            ["Temp class", tx.tempClass],
            ["Max ambient", unit(tx.maxAmbientTempC, "°C")],
            ["Oil type", tx.insulationOilType],
            ["Oil weight", unit(tx.oilWeightKg, "kg")],
            ["Oil volume", unit(tx.oilVolumeLitres, "L")],
            ["Total weight", unit(tx.totalWeightKg, "kg")],
            ["Year", tx.yearOfManufacture],
            ["Tap range", tx.tapRange],
          ];
          const filled = spec.filter(([, v]) => v != null && v !== "");
          const missing = spec.length - filled.length;
          return (
            <div className="mt-6 border-t border-line pt-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold tracking-wide text-ink-soft">NAMEPLATE</p>
                {canEditNameplate && missing > 0 && (
                  <Link href={`/transformers/${id}/edit`} className="inline-flex min-h-11 items-center text-[11px] font-bold text-kplc hover:underline">
                    {missing} field{missing === 1 ? "" : "s"} blank — complete it →
                  </Link>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {filled.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] text-ink-soft">{k}</dt>
                    <dd className="text-sm font-semibold text-navy">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })()}
      </div>

      {/* --- Documents ------------------------------------------------------ */}
      {tx.fatReportUrl && (
        <div className="mt-6 rounded-2xl border border-line bg-white p-6">
          <p className="text-[11px] font-bold tracking-wide text-ink-soft">📄 DOCUMENTS</p>
          <ul className="mt-3 divide-y divide-line">
            <li className="flex items-center gap-3 py-2.5">
              <span className="text-lg">📄</span>
              <div className="min-w-0 flex-1">
                <a
                  href={tx.fatReportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center font-bold text-navy hover:text-kplc"
                >
                  FAT Report
                </a>
                <p className="text-[11px] text-ink-soft">
                  {tx.fatReportUploadedAt ? `Uploaded ${formatDateTime(tx.fatReportUploadedAt)}` : "Uploaded"}
                  {tx.fatReportUploadedBy ? ` by ${tx.fatReportUploadedBy.name}` : ""}
                </p>
              </div>
              <a
                href={tx.fatReportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-line bg-white px-3 py-1.5 text-[11px] font-bold text-navy hover:border-kplc hover:text-kplc"
              >
                Open
              </a>
            </li>
          </ul>
        </div>
      )}

      {/* --- Location ------------------------------------------------------ */}
      {tx.currentLat != null && tx.currentLng != null && (
        <div className="mt-6 rounded-2xl border border-line bg-white p-6">
          <p className="text-[11px] font-bold tracking-wide text-ink-soft">LOCATION</p>
          <div className="mt-3">
            <StoryLocationMap lat={tx.currentLat} lng={tx.currentLng} />
          </div>
        </div>
      )}

      {/* --- Link status ---------------------------------------------------- */}
      <div className="mt-6">
        <LinkStatusBanner emdisReadingCount={emdisReadingCount} inspectionCount={inspectionCount} />
      </div>

      {/* --- Service summary ------------------------------------------------ */}
      <div className="mt-6">
        <ServiceSummaryCard summary={serviceSummary} />
      </div>

      {/* --- Movements -------------------------------------------------------
          The chain says the unit moved. This says who asked for it, who
          authorised it, which lorry carried it and when it turned up — the part
          of a journey that a tamper-evident hash cannot hold. */}
      {movements.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-5 py-3">
            <p className="text-sm font-bold text-navy">Movements</p>
          </div>
          <ul className="divide-y divide-line">
            {movements.map((mv) => {
              const meta =
                TRANSACTION_STATUS_META[mv.status as TransactionStatus] ?? {
                  label: mv.status,
                  tone: "neutral" as const,
                };
              return (
                <li key={mv.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy">
                      {mv.fromName} → {mv.toName}
                    </p>
                    <p className="truncate text-xs text-ink-soft">
                      {MOVEMENTS[mv.movement as MovementKey]?.label ?? mv.movement}
                      {mv.vehiclePlate ? ` · ${mv.vehiclePlate}` : ""}
                      {mv.driverName ? ` · ${mv.driverName}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-ink-soft">
                      raised by {mv.initiatedBy.name}
                      {mv.approvedBy ? ` · approved by ${mv.approvedBy.name}` : ""}
                      {mv.receivedBy ? ` · received by ${mv.receivedBy.name}` : ""}
                    </p>
                  </div>
                  <Link href={`/transactions/${mv.id}`} className="shrink-0 inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-bold text-kplc hover:underline">
                    Track
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* --- Tabs --------------------------------------------------------- */}
      <div className="mt-6">
        <StoryTabs
          story={story}
          tests={tests}
          warranty={warranty}
          verification={verification}
          repairs={repairs}
          ratingKva={tx.ratingKva}
          repairCount={tx.repairCount}
        />
      </div>
    </div>
  );
}
