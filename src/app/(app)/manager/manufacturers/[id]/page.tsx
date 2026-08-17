import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getManufacturerDetail } from "@/lib/manufacturer-performance";
import { STATUS_META, formatKes, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getManufacturerDetail(id);
  return { title: detail ? detail.manufacturer.name : "Manufacturer" };
}

export const dynamic = "force-dynamic";

export default async function ManufacturerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  const detail = await getManufacturerDetail(id);
  if (!detail) notFound();

  const { manufacturer, transformers, claims, tests } = detail;

  // Per-transformer IR/BDV trend, for the trend table.
  const testsByTx = new Map<string, typeof tests>();
  for (const t of tests) {
    const list = testsByTx.get(t.transformerId) ?? [];
    list.push(t);
    testsByTx.set(t.transformerId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/manufacturers" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Manufacturer performance
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">{manufacturer.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {manufacturer.country ?? "Country unknown"} · {transformers.length} unit{transformers.length === 1 ? "" : "s"} on the register ·{" "}
          {manufacturer.warrantyMonths} month warranty
        </p>
      </div>

      {/* --- Fleet --------------------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">Fleet</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
              <tr>
                <th className="px-3 py-2">G-Number</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">Health score</th>
                <th className="px-3 py-2">Faults</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transformers.map((t) => (
                <tr key={t.id} className={t.faultCount > 0 ? "bg-red-50/30" : undefined}>
                  <td className="px-3 py-2">
                    <Link href={`/transformers/${t.id}`} className="inline-flex min-h-11 items-center font-bold text-navy hover:text-kplc">
                      {t.gNumber ? `G-${t.gNumber}` : t.serialNumber}
                    </Link>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-ink-soft">{t.siteName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_META[t.status as keyof typeof STATUS_META]?.tone ?? "neutral"}>
                      {STATUS_META[t.status as keyof typeof STATUS_META]?.label ?? t.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-navy">{t.ageYears} yr</td>
                  <td className="px-3 py-2 text-navy">{t.healthScore ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={t.faultCount > 0 ? "font-bold text-red-700" : "text-ink-soft"}>{t.faultCount}</span>
                  </td>
                </tr>
              ))}
              {transformers.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-soft">No units from this manufacturer.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- Warranty claims ------------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">Warranty claims ({claims.length})</h2>
        </div>
        <ul className="divide-y divide-line">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone={c.status === "APPROVED" || c.status === "CLOSED" ? "success" : c.status === "REJECTED" ? "danger" : "warning"}>
                    {c.status}
                  </Badge>
                  <Link href={`/transformers/${c.transformerId}`} className="font-mono text-xs font-bold text-navy hover:text-kplc">
                    {c.transformer.gNumber ? `G-${c.transformer.gNumber}` : c.transformer.serialNumber}
                  </Link>
                  <span className="text-[11px] text-ink-soft">{formatDate(c.createdAt)}</span>
                </div>
                <p className="mt-1 text-[13px] text-navy">{c.faultReason}</p>
              </div>
              {c.claimValueKes != null && (
                <p className="shrink-0 text-sm font-bold text-navy">{formatKes(Number(c.claimValueKes))}</p>
              )}
            </li>
          ))}
          {claims.length === 0 && (
            <li className="px-5 py-8 text-center text-xs text-ink-soft">No warranty claims against this manufacturer.</li>
          )}
        </ul>
      </div>

      {/* --- Test trends ------------------------------------------------------ */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-navy">Test value trends</h2>
          <p className="mt-0.5 text-xs text-ink-soft">First and last recorded value per unit with at least two tests.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
              <tr>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Tests</th>
                <th className="px-3 py-2">IR HV first → last</th>
                <th className="px-3 py-2">Oil BDV first → last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transformers.filter((t) => (testsByTx.get(t.id)?.length ?? 0) > 0).map((t) => {
                const series = testsByTx.get(t.id) ?? [];
                const ir = series.filter((s) => s.insulationResistanceHvMohm != null);
                const bdv = series.filter((s) => s.oilBdvKv != null);
                return (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-bold text-navy">{t.gNumber ? `G-${t.gNumber}` : t.serialNumber}</td>
                    <td className="px-3 py-2 text-ink-soft">{series.length}</td>
                    <td className="px-3 py-2 text-navy">
                      {ir.length >= 2 ? `${ir[0].insulationResistanceHvMohm} → ${ir[ir.length - 1].insulationResistanceHvMohm} MΩ` : "—"}
                    </td>
                    <td className="px-3 py-2 text-navy">
                      {bdv.length >= 2 ? `${bdv[0].oilBdvKv} → ${bdv[bdv.length - 1].oilBdvKv} kV` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-soft">
        Warranty terms: {manufacturer.warrantyMonths} months. Contact: {manufacturer.contactName ?? "—"}
        {manufacturer.contactEmail ? ` · ${manufacturer.contactEmail}` : ""}
        {manufacturer.contactPhone ? ` · ${manufacturer.contactPhone}` : ""}
      </p>
    </div>
  );
}
