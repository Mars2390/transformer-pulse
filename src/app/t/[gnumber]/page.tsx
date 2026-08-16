import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { qrDataUrl, siteUrl, transformerQrUrl } from "@/lib/qr";
import { deriveHealthStatus, HEALTH_STATUS_META } from "@/lib/health-status";
import { buildPriorityList } from "@/lib/combined-health";
import { computeWarranty } from "@/lib/warranty";
import { measured, unit, pair } from "@/lib/measure";
import { STATUS_META, EVENT_META, formatRating, formatDateTime } from "@/lib/format";
import { KplcMark } from "@/components/brand/KplcLogo";

export const dynamic = "force-dynamic";

/**
 * Where a scanned QR code lands.
 *
 * This used to redirect straight to the signed-in story page. That meant a
 * technician standing at a pole with an expired session, or a colleague's
 * phone, got a login form and no confirmation they were even looking at the
 * right transformer. The identifier was in their hand and the system would not
 * acknowledge it.
 *
 * So it is now a page in its own right. It answers the question somebody asks
 * while standing next to the unit — what is this, is it healthy, what has
 * happened to it — with no app chrome, no sidebar, and a layout that prints.
 *
 * WHAT IT DELIBERATELY WITHHOLDS
 * ------------------------------
 * Everything that would help somebody steal the unit or expose an individual:
 *
 *   - no GPS, no map, no feeder or customer name
 *   - no staff names against any event. A public page naming the engineer who
 *     signed off a failure is a page that gets somebody disciplined by a
 *     stranger
 *   - no test readings, costs, warranty values or supplier disputes
 *   - no chain hashes. A tamper-evidence mechanism published in full is one
 *     somebody can work against offline
 *
 * What it shows is the identity of the asset, its current condition, and the
 * SHAPE of its history — dates and event types. That is enough to confirm you
 * are at the right unit and to see that it is tracked, which is the entire
 * point of putting a code on a pole. The full record, with names and readings,
 * is one sign-in away and stays that way.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ gnumber: string }>;
}): Promise<Metadata> {
  const { gnumber } = await params;
  const g = decodeURIComponent(gnumber).toUpperCase();
  return {
    title: `${g} · KPLC Transformer DNA`,
    description: "Verified lifecycle record for a Kenya Power distribution transformer.",
    // Asset identifiers should not end up in a search index. Not a security
    // control on its own — it is a request, and only honest crawlers honour it.
    robots: { index: false, follow: false },
  };
}

/** Event types a member of the public may see the existence of. */
const PUBLIC_EVENTS = new Set([
  "RECEIVED_AT_STORE",
  "APPROVED_FOR_STOCK",
  "DISPATCHED",
  "RECEIVED_ON_SITE",
  "INSTALLED",
  "COMMISSIONED",
  "INSPECTED",
  "FAULT_REPORTED",
  "REMOVED_FROM_SITE",
  "SENT_TO_WORKSHOP",
  "REPAIR_COMPLETED",
  "RETURNED_TO_STORE",
  "CONDEMNED",
  "SCRAPPED",
]);

export default async function QrLandingPage({
  params,
}: {
  params: Promise<{ gnumber: string }>;
}) {
  const { gnumber } = await params;
  const gNumber = decodeURIComponent(gnumber).toUpperCase();

  // Serial as well as G-Number, because a label printed before a G-Number was
  // issued carries the serial, and those labels are already on transformers.
  const tx = await prisma.transformer.findFirst({
    where: {
      OR: [
        { gNumber: { equals: gNumber, mode: "insensitive" } },
        { serialNumber: { equals: gNumber, mode: "insensitive" } },
      ],
    },
    include: {
      manufacturer: { select: { name: true } },
      events: { orderBy: { occurredAt: "desc" }, select: { type: true, occurredAt: true } },
    },
  });
  if (!tx) notFound();

  // Signed in? Then the full record is worth offering directly. Signed out is
  // the normal case for a scan, and this page has to stand on its own.
  const viewer = await getSession().catch(() => null);

  const priorityRows = await buildPriorityList({ transformerIds: [tx.id], allStatuses: true });
  const row = priorityRows[0] ?? null;
  const health = deriveHealthStatus({
    electrical: row?.electrical ?? null,
    physical: row?.physical ?? null,
    status: tx.status,
    reasons: row?.reasons ?? [],
  });
  const meta = HEALTH_STATUS_META[health.level];

  const w = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
  const label = tx.gNumber ?? tx.serialNumber;
  const qr = await qrDataUrl(transformerQrUrl(siteUrl(), tx.gNumber, tx.id), 200);

  const timeline = tx.events.filter((e) => PUBLIC_EVENTS.has(e.type));
  const inService = tx.commissionDate
    ? Math.floor((Date.now() - tx.commissionDate.getTime()) / 31_557_600_000)
    : null;

  const spec: [string, string | null][] = [
    ["Rating", formatRating(tx.ratingKva)],
    ["Voltage", `${tx.primaryKv} / ${tx.secondaryKv} kV`],
    ["Phases", `${tx.phases}`],
    ["Manufacturer", tx.manufacturer.name],
    ["Year of manufacture", `${tx.yearOfManufacture}`],
    ["Cooling", tx.coolingType || null],
    ["Vector group", tx.vectorGroup || null],
    ["Impedance", measured(tx.impedancePct) != null ? `${tx.impedancePct}%` : null],
    ["Frequency", unit(tx.frequencyHz, "Hz")],
    ["Temp rise oil/winding", pair(tx.tempRiseOilC, tx.tempRiseWindingC, "°C")],
    ["Oil volume", unit(tx.oilVolumeLitres, "L")],
    ["Total weight", unit(tx.totalWeightKg, "kg")],
  ];
  const shown = spec.filter(([, v]) => v != null && v !== "");
  const blank = spec.length - shown.length;

  return (
    <main className="min-h-svh bg-surface px-4 py-6 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* --- Identity ------------------------------------------------- */}
        <header className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-start gap-4">
            <KplcMark className="h-11 w-11 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                Kenya Power · Transformer DNA
              </p>
              <h1 className="mt-0.5 break-all font-mono text-2xl font-extrabold tracking-tight text-navy">
                {label}
              </h1>
              <p className="mt-1 text-sm text-ink-soft">
                {formatRating(tx.ratingKva)} · {tx.primaryKv}/{tx.secondaryKv} kV · {tx.manufacturer.name}
              </p>
            </div>
            {/* On screen the reader already scanned the code. On paper this is
                what makes the printout re-scannable, so it appears only there. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" aria-hidden="true" className="hidden h-20 w-20 shrink-0 print:block" />
          </div>

          {/* Condition and status sit side by side deliberately. They used to
              contradict each other — a FAULTY unit wearing a green badge —
              because the badge fell back to "no data recorded" whenever no test
              score existed. Printing them together means any future
              disagreement is visible at a glance instead of hidden on
              separate tabs. */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl px-3.5 py-3" style={{ backgroundColor: meta.colour + "14" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">Condition</p>
              <p className="mt-0.5 text-sm font-extrabold" style={{ color: meta.colour }}>
                {meta.emoji} {meta.label.toUpperCase()}
              </p>
              <p className="mt-1 text-xs leading-snug text-ink">{health.explanation}</p>
            </div>
            <div className="rounded-xl bg-surface-2 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                Current status
              </p>
              <p className="mt-0.5 text-sm font-extrabold text-navy">{STATUS_META[tx.status].label}</p>
              <p className="mt-1 text-xs leading-snug text-ink-soft">
                {inService != null
                  ? `In service ${inService} year${inService === 1 ? "" : "s"}.`
                  : "Not yet commissioned."}
                {(w.state === "UNDER_WARRANTY" || w.state === "EXPIRING_SOON") &&
                w.daysRemaining != null
                  ? ` Under warranty, ${w.daysRemaining} days left.`
                  : w.state === "EXPIRED"
                    ? " Warranty expired."
                    : ""}
              </p>
            </div>
          </div>
        </header>

        {/* --- Nameplate ------------------------------------------------ */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">Nameplate</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
            {shown.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-ink-soft">{k}</dt>
                <dd className="text-sm font-semibold text-navy">{v}</dd>
              </div>
            ))}
          </dl>
          {blank > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-ink-soft">
              {blank} field{blank === 1 ? " is" : "s are"} blank because the plate does not carry{" "}
              {blank === 1 ? "it" : "them"}, or it has not been read yet. Blank means unknown here —
              it is never filled in with a typical value.
            </p>
          )}
        </section>

        {/* --- Timeline ------------------------------------------------- */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft">
            Life story · {timeline.length} recorded event{timeline.length === 1 ? "" : "s"}
          </h2>

          {timeline.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Nothing has been recorded against this unit yet.
            </p>
          ) : (
            <ol className="mt-4">
              {timeline.map((e, i) => {
                const em = EVENT_META[e.type];
                return (
                  <li key={`${e.type}-${i}`} className="relative flex gap-3.5 pb-5 last:pb-0">
                    {i < timeline.length - 1 && (
                      <span className="absolute left-[5px] top-3 h-full w-px bg-line" aria-hidden="true" />
                    )}
                    <span
                      aria-hidden="true"
                      className={`relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        em.tone === "danger"
                          ? "bg-red-500"
                          : em.tone === "warning"
                            ? "bg-amber-500"
                            : em.tone === "success"
                              ? "bg-emerald-500"
                              : "bg-kplc"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-navy">{em.label}</p>
                      <p className="text-[11px] text-ink-soft">{formatDateTime(e.occurredAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-soft">
            Every entry is hash-linked to the one before it, so an event cannot be altered or removed
            without breaking the chain. Names, test readings and locations are held in the signed-in
            record.
          </p>
        </section>

        {/* --- Actions --------------------------------------------------- */}
        {/* The dossier PDF carries names, readings and costs, so it stays
            behind a sign-in. Showing a Download button to a signed-out visitor
            and having it return 401 would be worse than not showing it. */}
        <div className="flex flex-wrap gap-2 print:hidden">
          {viewer ? (
            <>
              <a
                href={`/api/pdf/transformer/${tx.id}`}
                className="flex-1 rounded-xl bg-navy px-4 py-3 text-center text-sm font-bold text-white"
              >
                Download PDF
              </a>
              <Link
                href={`/transformers/${tx.id}`}
                className="flex-1 rounded-xl bg-kplc px-4 py-3 text-center text-sm font-bold text-white"
              >
                Open full record
              </Link>
            </>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/transformers/${tx.id}`)}`}
              className="flex-1 rounded-xl bg-kplc px-4 py-3 text-center text-sm font-bold text-white"
            >
              View full story · KPLC sign-in
            </Link>
          )}
          <PrintButton />
        </div>

        <p className="pb-6 text-center text-[11px] leading-relaxed text-ink-soft print:hidden">
          Scanned from a KPLC asset label. If this transformer is damaged, leaking or making an
          unusual noise, do not approach it — report it on 95551.
        </p>
      </div>
    </main>
  );
}

/** Print is a browser action, so it needs the one client boundary on the page. */
function PrintButton() {
  return (
    <details className="w-full text-center">
      <summary className="cursor-pointer list-none rounded-xl border border-line bg-white px-4 py-3 text-sm font-bold text-navy">
        Print this page
      </summary>
      <p className="mt-2 text-[11px] text-ink-soft">
        Press Ctrl&nbsp;+&nbsp;P (⌘&nbsp;+&nbsp;P on a Mac). The page is laid out for A4 and the QR
        code is included on the printout so the sheet can be re-scanned.
      </p>
    </details>
  );
}
