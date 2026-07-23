import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRelative } from "@/lib/format";
import { CANON_LABEL, type CanonField } from "@/lib/universal-columns";
import { ProfileRowActions } from "@/components/admin/ProfileRowActions";

export const metadata: Metadata = { title: "Load-data formats" };
export const dynamic = "force-dynamic";

export default async function LoadFormatsPage() {
  await requireRole("ADMIN");

  const profiles = await prisma.columnMappingProfile.findMany({
    orderBy: { lastUsedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Admin
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Load-data formats</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Saved column-mapping profiles. When a load-data file&apos;s columns match one of these, it is
          recognised on sight and imports without re-confirming the mapping. Profiles are created from the
          load-data confirm screen by ticking &ldquo;Save this mapping as a profile&rdquo;.
        </p>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center">
          <p className="text-sm font-semibold text-navy">No saved formats yet</p>
          <p className="mt-1 text-xs text-ink-soft">
            The recognizer already handles most files automatically. A profile is only needed when a vendor
            uses unusual column names you want remembered.
          </p>
          <Link
            href="/manager/emdis"
            className="mt-4 inline-block rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white hover:bg-kplc-dark"
          >
            Go to load data
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <ul className="divide-y divide-line">
            {profiles.map((p) => {
              const map = (p.mapping ?? {}) as Record<string, CanonField>;
              const entries = Object.entries(map);
              return (
                <li key={p.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-navy">{p.name}</p>
                    <p className="text-xs text-ink-soft">
                      {p.timesUsed} use{p.timesUsed === 1 ? "" : "s"} · {p.createdByName} · last{" "}
                      {formatRelative(p.lastUsedAt)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entries.map(([header, field]) => (
                      <span key={header} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px]">
                        <span className="font-mono text-ink-soft">{header}</span>
                        <span className="mx-1 text-ink-soft">→</span>
                        <span className="font-semibold text-navy">{CANON_LABEL[field] ?? field}</span>
                      </span>
                    ))}
                  </div>
                  <div className="mt-3">
                    <ProfileRowActions id={p.id} name={p.name} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
