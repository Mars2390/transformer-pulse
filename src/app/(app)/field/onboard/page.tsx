import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FieldOnboardForm } from "@/components/field/FieldOnboardForm";

export const metadata: Metadata = { title: "Onboard existing transformer" };
export const dynamic = "force-dynamic";

/**
 * A field engineer adding a transformer that is already on a pole.
 *
 * Until now only a store keeper or an admin could do this, from a desk, by
 * clicking a map. That put the record furthest from the evidence: the person
 * who can actually see the transformer, read its plate and stand under it with
 * a GPS had no way to add it. This page closes that gap.
 */
export default async function FieldOnboardPage() {
  const user = await requireRole("FIELD_ENGINEER", "ADMIN");

  const manufacturers = await prisma.manufacturer.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-lg pb-20">
      <Link href="/field/dashboard" className="text-xs font-bold text-ink-soft transition-colors hover:text-kplc">
        ← My work
      </Link>

      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">
        Onboard an existing transformer
      </h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        For a unit already energised that this system has never recorded. You do not need approval —
        your name, GPS fix and substation go on the record instead.
      </p>

      <div className="mt-5">
        <FieldOnboardForm manufacturers={manufacturers} engineerName={user.name} />
      </div>
    </div>
  );
}
