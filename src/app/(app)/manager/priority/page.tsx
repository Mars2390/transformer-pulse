import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { buildPriorityList, bandOf } from "@/lib/combined-health";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Repair priority" };
export const dynamic = "force-dynamic";

const BAND_STYLE: Record<string, string> = {
  RED: "bg-red-100 text-red-800",
  AMBER: "bg-amber-100 text-amber-900",
  GREEN: "bg-kplc/10 text-kplc",
  UNKNOWN: "bg-surface-2 text-ink-soft",
};

export default async function PriorityPage({
  searchParams,
}: {
  searchParams: Promise<{ band?: string; defect?: string; region?: string }>;
}) {
  const user = await requireRole("ADMIN", "MANAGER");
  const sp = await searchParams;

  const scope = user.role === "MANAGER" && user.region ? user.region : (sp.region ?? null);
  const all = await buildPriorityList({ region: scope });

  const rows = all.filter((r) => {
    if (sp.band && bandOf(r.priority) !== sp.band) return false;
    if (sp.defect === "phase" && !(r.peakPhasePct != null && r.peakPhasePct >= 100)) return false;
    if (sp.defect === "pole" && !(r.structure === "ROTTEN" || r.structure === "LEANING")) return false;
    if (sp.defect === "earth" && !r.openEarth) return false;
    if (sp.defect === "fuse" && !r.fuseCarriersBad) return false;
    if (sp.defect === "ir" && r.irLowMohm == null) return false;
    return true;
  });

  const actNow = all.filter((r) => bandOf(r.priority) === "RED");
  const counts = {
    red: all.filter((r) => bandOf(r.priority) === "RED").length,
    amber: all.filter((r) => bandOf(r.priority) === "AMBER").length,
    green: all.filter((r) => bandOf(r.priority) === "GREEN").length,
    phase: all.filter((r) => r.peakPhasePct != null && r.peakPhasePct >= 100).length,
    pole: all.filter((r) => r.structure === "ROTTEN" || r.structure === "LEANING").length,
    earth: all.filter((r) => r.openEarth).length,
    fuse: all.filter((r) => r.fuseCarriersBad).length,
    noData: all.filter((r) => r.electrical == null && r.physical == null).length,
  };

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { band: sp.band, defect: sp.defect, region: sp.region, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/manager/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Repair priority</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Measured electrical stress and observed physical condition, scored separately and ranked
            together. A sound pole does not excuse a cooking winding, so the worse of the two axes
            drives the ranking.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/reports/priority?format=xlsx${qs({}).replace("?", "&")}`} className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc">XLSX</a>
          <a href={`/api/reports/priority?format=csv${qs({}).replace("?", "&")}`} className="rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-navy hover:border-kplc">CSV</a>
          <a href="/api/pdf/priority" className="rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark">PDF</a>
        </div>
      </div>

      {/* --- Act now -------------------------------------------------------- */}
      {actNow.length > 0 && (
        <div className="overflow-hidden rounded-2xl border-2 border-red-300 bg-red-50">
          <div className="border-b border-red-200 bg-red-100 px-5 py-2.5">
            <p className="text-[11px] font-extrabold tracking-[0.12em] text-red-900">
              ACT NOW — {actNow.length} TRANSFORMER{actNow.length === 1 ? "" : "S"}
            </p>
          </div>
          <ul className="divide-y divide-red-200">
            {actNow.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Link href={`/transformers/${r.id}`} className="text-sm font-extrabold text-navy hover:text-kplc">
                  {r.gNumber ? `G-${r.gNumber}` : r.serialNumber}
                </Link>
                <span className="text-xs text-ink-soft">{r.ratingKva} kVA · {r.siteName ?? r.substationCode ?? "—"}</span>
                <span className="ml-auto text-xs font-semibold text-red-900">{r.topReason}</span>
              </li>
            ))}
          </ul>
          {actNow.length > 5 && (
            <p className="border-t border-red-200 px-5 py-2 text-xs text-red-800">
              and {actNow.length - 5} more below.
            </p>
          )}
        </div>
      )}

      {/* --- Counts --------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Red" value={counts.red} href={`/manager/priority${qs({ band: "RED", defect: undefined })}`} tone="bad" />
        <Tile label="Amber" value={counts.amber} href={`/manager/priority${qs({ band: "AMBER", defect: undefined })}`} tone="warn" />
        <Tile label="Green" value={counts.green} href={`/manager/priority${qs({ band: "GREEN", defect: undefined })}`} tone="good" />
        <Tile label="Never measured" value={counts.noData} hint="no inspection, no load data" />
      </div>

      {/* --- Filters -------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={`/manager/priority${qs({ band: undefined, defect: undefined })}`} active={!sp.band && !sp.defect}>All {formatNumber(all.length)}</Chip>
        <Chip href={`/manager/priority${qs({ defect: "phase", band: undefined })}`} active={sp.defect === "phase"}>Phase overload {counts.phase}</Chip>
        <Chip href={`/manager/priority${qs({ defect: "pole", band: undefined })}`} active={sp.defect === "pole"}>Rotten / leaning {counts.pole}</Chip>
        <Chip href={`/manager/priority${qs({ defect: "earth", band: undefined })}`} active={sp.defect === "earth"}>Open earth {counts.earth}</Chip>
        <Chip href={`/manager/priority${qs({ defect: "fuse", band: undefined })}`} active={sp.defect === "fuse"}>Fuse carriers {counts.fuse}</Chip>
        <Chip href={`/manager/priority${qs({ defect: "ir", band: undefined })}`} active={sp.defect === "ir"}>Low IR</Chip>
        <span className="ml-auto text-xs text-ink-soft">{formatNumber(rows.length)} shown</span>
      </div>

      {/* --- Table ---------------------------------------------------------- */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[880px] text-left text-xs">
          <thead className="border-b border-line bg-surface-2 text-[11px] font-bold text-ink-soft">
            <tr>
              <th className="px-3 py-2">Rank</th>
              <th className="px-3 py-2">Transformer</th>
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2">Electrical</th>
              <th className="px-3 py-2">Physical</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Leading reason</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.slice(0, 300).map((r, i) => (
              <tr key={r.id} className={bandOf(r.priority) === "RED" ? "bg-red-50/40" : undefined}>
                <td className="px-3 py-2 font-mono text-ink-soft">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/transformers/${r.id}`} className="font-bold text-navy hover:text-kplc">
                    {r.gNumber ? `G-${r.gNumber}` : r.serialNumber}
                  </Link>
                  <span className="ml-2 text-ink-soft">{r.ratingKva} kVA</span>
                </td>
                <td className="max-w-[190px] truncate px-3 py-2 text-ink-soft">
                  {r.siteName ?? r.substationCode ?? "—"}
                </td>
                <td className="px-3 py-2"><Score s={r.electrical} /></td>
                <td className="px-3 py-2"><Score s={r.physical} /></td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-extrabold ${BAND_STYLE[bandOf(r.priority)]}`}>
                    {r.priority}
                  </span>
                </td>
                <td className="max-w-[280px] px-3 py-2">
                  <span className="block truncate text-navy">{r.topReason}</span>
                  {r.reasons.length > 1 && (
                    <span className="text-[10px] text-ink-soft">+{r.reasons.length - 1} more</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-soft">
                  {r.lastInspectionAt ? r.lastInspectionAt.toISOString().slice(0, 10) : "never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 300 && (
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-soft">
            Showing the worst 300 of {formatNumber(rows.length)}. The export contains all of them.
          </p>
        )}
      </div>

      <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        <strong className="text-navy">A blank score is not a good score.</strong> Where a transformer
        has no load data or no inspection, the axis reads &ldquo;—&rdquo; rather than 100. A unit
        nobody has measured is not a healthy unit, and a ranking that pretended otherwise would bury
        the worst assets in the fleet.
      </p>
    </div>
  );
}

function Score({ s }: { s: number | null }) {
  if (s == null) return <span className="text-ink-soft">—</span>;
  const b = bandOf(s);
  return <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${BAND_STYLE[b]}`}>{s}</span>;
}

function Tile({ label, value, href, tone, hint }: { label: string; value: number; href?: string; tone?: "good" | "warn" | "bad"; hint?: string }) {
  const c = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-kplc" : "text-navy";
  const inner = (
    <div className="rounded-xl border border-line bg-white p-4 transition hover:border-kplc">
      <p className="text-[11px] font-bold tracking-wide text-ink-soft">{label.toUpperCase()}</p>
      <p className={`mt-1 text-2xl font-extrabold ${c}`}>{formatNumber(value)}</p>
      {hint && <p className="text-[10px] text-ink-soft">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold ${active ? "bg-navy text-white" : "border border-line bg-white text-ink-soft hover:text-navy"}`}
    >
      {children}
    </Link>
  );
}
