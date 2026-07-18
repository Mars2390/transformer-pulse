import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ImportWizard } from "@/components/store/ImportWizard";

export const metadata: Metadata = { title: "Import transformers" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await requireRole("STORE_KEEPER", "ADMIN");
  const manufacturers = await prisma.manufacturer.findMany({ orderBy: { name: "asc" }, select: { name: true } });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link
          href={user.role === "ADMIN" ? "/admin/dashboard" : "/store/dashboard"}
          className="text-xs font-bold text-ink-soft transition-colors hover:text-kplc"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Import transformers</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Bring an existing register in from CSV or Excel. Every imported unit gets a
          full event chain, so it verifies like any other transformer.
        </p>
      </div>

      {/* The importer can only match manufacturers it already knows — say so up
          front rather than letting every row fail validation for one reason. */}
      <div className="rounded-2xl border border-kplc/15 bg-kplc/5 px-5 py-4">
        <p className="text-xs font-bold text-navy">
          Manufacturers must already exist ({manufacturers.length} registered)
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          {manufacturers.map((m) => m.name).join(" · ")}
        </p>
        <p className="mt-2 text-xs text-ink-soft">
          Spelling is matched loosely — &ldquo;ABB Kenya Ltd&rdquo; finds &ldquo;ABB&rdquo;. Anything
          unrecognised is reported per row.
          {user.role === "ADMIN" && (
            <> <Link href="/admin/manufacturers" className="font-bold text-kplc hover:underline">Add a manufacturer →</Link></>
          )}
        </p>
      </div>

      <ImportWizard />
    </div>
  );
}
