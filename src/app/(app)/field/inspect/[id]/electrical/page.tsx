import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ElectricalTestForm } from "@/components/field/ElectricalTestForm";

export const metadata: Metadata = { title: "IR / WR test" };
export const dynamic = "force-dynamic";

export default async function ElectricalTestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("FIELD_ENGINEER", "STORE_KEEPER", "ADMIN");
  const { id } = await params;

  const tx = await prisma.transformer.findUnique({
    where: { id },
    select: {
      id: true, gNumber: true, serialNumber: true, ratingKva: true,
      currentSiteName: true, substationCode: true,
      tests: {
        where: { stage: "FIELD_DIAGNOSTIC" },
        orderBy: { testedAt: "desc" },
        take: 3,
        select: {
          testedAt: true, irCorrectedTo20C: true, windingTempC: true,
          polarizationIndex: true, passed: true, irTestVoltageV: true,
        },
      },
    },
  });
  if (!tx) notFound();

  const label = tx.gNumber ? `G-${tx.gNumber}` : tx.serialNumber;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <Link href={`/transformers/${tx.id}`} className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← {label}
        </Link>
        <h1 className="mt-2 text-xl font-extrabold tracking-tight text-navy">
          Insulation &amp; winding resistance
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {tx.currentSiteName ?? tx.substationCode ?? "—"}
        </p>
      </div>

      {tx.tests.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-[11px] font-bold tracking-wide text-ink-soft">PREVIOUS TESTS</p>
          <ul className="mt-2 space-y-1.5">
            {tx.tests.map((t, i) => (
              <li key={i} className="flex items-baseline justify-between text-xs">
                <span className="text-ink-soft">
                  {t.testedAt.toISOString().slice(0, 10)}
                  {t.irTestVoltageV ? ` · ${t.irTestVoltageV >= 1000 ? `${t.irTestVoltageV / 1000} kV` : `${t.irTestVoltageV} V`}` : ""}
                  {t.windingTempC != null ? ` · ${t.windingTempC} °C` : ""}
                </span>
                <span className={`font-bold ${t.passed ? "text-kplc" : "text-red-700"}`}>
                  {t.irCorrectedTo20C != null ? `${t.irCorrectedTo20C.toFixed(t.irCorrectedTo20C < 10 ? 2 : 0)} MΩ` : "—"}
                  {t.polarizationIndex != null ? ` · PI ${t.polarizationIndex.toFixed(2)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-ink-soft">
            All corrected to 20 °C, so these are directly comparable.
          </p>
        </div>
      )}

      <ElectricalTestForm transformerId={tx.id} label={label} ratingKva={tx.ratingKva} />
    </div>
  );
}
