import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { qrDataUrl, siteUrl, transformerQrUrl } from "@/lib/qr";
import { formatRating } from "@/lib/format";
import { inputClass } from "@/components/ui/Field";
import Link from "next/link";

export const metadata: Metadata = { title: "QR labels" };
export const dynamic = "force-dynamic";

const PER_PAGE = 12;

/**
 * Printable QR labels, twelve to an A4 sheet.
 *
 * Rendered on the SERVER as data URLs rather than drawn in the browser, because
 * the thing that has to work is Ctrl-P on a depot PC with an old printer — and
 * a page whose codes are painted by JavaScript after load is a page that prints
 * blank about a third of the time.
 *
 * Every label carries the G-Number in readable text under the code. If the code
 * is scratched, scuffed, or painted over — and outdoors, some will be — the
 * label still does its job, which a bare QR square would not.
 */
export default async function QrCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireRole("ADMIN", "MANAGER", "STORE_KEEPER");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const where = {
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(q
      ? {
          OR: [
            { gNumber: { contains: q, mode: "insensitive" as const } },
            { serialNumber: { contains: q, mode: "insensitive" as const } },
            { currentSiteName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.transformer.count({ where }),
    prisma.transformer.findMany({
      where,
      select: { id: true, gNumber: true, serialNumber: true, ratingKva: true, currentSiteName: true },
      orderBy: { gNumber: "asc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ]);

  const root = siteUrl();
  const labels = await Promise.all(
    rows.map(async (t) => ({
      ...t,
      dataUrl: await qrDataUrl(transformerQrUrl(root, t.gNumber, t.id), 220),
    })),
  );

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">QR labels</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Twelve to an A4 sheet. Print, cut, and mount on the transformer. Scanning one opens its
          full history — after a KPLC sign-in, so a label on a pole gives a passer-by nothing.
        </p>

        <form method="get" className="mt-4 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="🔍 G-Number, serial or site"
            className={`${inputClass} w-64 py-2 text-xs`}
          />
          <button type="submit" className="rounded-xl bg-kplc px-4 py-2 text-xs font-bold text-white">
            Filter
          </button>
          <span className="self-center text-xs text-ink-soft">
            {total} transformers · sheet {page} of {pages}
          </span>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {page > 1 && (
            <Link
              href={`/admin/qr-codes?q=${encodeURIComponent(q)}&page=${page - 1}`}
              className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-navy"
            >
              ← Previous sheet
            </Link>
          )}
          {page < pages && (
            <Link
              href={`/admin/qr-codes?q=${encodeURIComponent(q)}&page=${page + 1}`}
              className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-navy"
            >
              Next sheet →
            </Link>
          )}
          <span className="ml-auto text-xs font-bold text-ink-soft">Ctrl&nbsp;+&nbsp;P to print</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {labels.map((t) => (
          <div
            key={t.id}
            className="flex flex-col items-center rounded-xl border border-line bg-white p-3 text-center print:break-inside-avoid"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.dataUrl} alt={`QR for ${t.gNumber ?? t.serialNumber}`} className="h-28 w-28" />
            <p className="mt-2 text-[11px] font-bold tracking-wide text-navy">KPLC</p>
            <p className="font-mono text-xs font-bold text-navy">{t.gNumber ?? t.serialNumber}</p>
            <p className="text-[11px] text-ink-soft">{formatRating(t.ratingKva)}</p>
            <p className="text-[10px] text-ink-soft">Scan for history</p>
          </div>
        ))}
      </div>

      {labels.length === 0 && (
        <p className="text-sm text-ink-soft">No transformer matches that filter.</p>
      )}
    </div>
  );
}
