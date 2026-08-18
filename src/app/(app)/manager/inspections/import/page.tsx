import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { InspectionImport } from "@/components/manager/InspectionImport";
import { formatNumber, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Import inspection register" };
export const dynamic = "force-dynamic";

export default async function InspectionImportPage() {
  await requireRole("ADMIN", "MANAGER");

  const [total, batches] = await Promise.all([
    prisma.substationInspection.count(),
    prisma.importBatch.findMany({
      where: { kind: "INSPECTION" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">
          Import inspection register
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          KPLC&apos;s substation inspection export — pole condition, earthing, protection and the
          inspector&apos;s loading judgement. Matched to transformers by G-Number, then serial, then
          substation code. {total > 0 && `${formatNumber(total)} inspections held.`}
        </p>
      </div>

      <InspectionImport />

      {batches.length > 0 && (
        <div className="rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-bold text-navy">Recent imports</h2>
          </div>
          <ul className="divide-y divide-line">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs">
                <span className="font-semibold text-navy">{b.fileName}</span>
                <span className="text-ink-soft">
                  {b.rowsImported} matched · {b.rowsStaged} staged · {b.rowsFlagged} flagged
                </span>
                <span className="ml-auto text-ink-soft">
                  {b.uploadedByName} · {formatRelative(b.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
