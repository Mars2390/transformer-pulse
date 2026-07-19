import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { StagingReview } from "@/components/manager/StagingReview";

export const metadata: Metadata = { title: "Staged inspections" };
export const dynamic = "force-dynamic";

export default async function StagingPage() {
  await requireRole("ADMIN", "MANAGER");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/manager/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Staged inspections</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Real transformers that KPLC inspected but which are not yet on this register. Promoting one
          creates the asset with a sealed genesis event and its full inspection history. Nothing here is
          created automatically — the inspection register has unreadable serials and defaced plate
          numbers, and auto-creating from it would put duplicates on the register.
        </p>
      </div>

      <StagingReview />
    </div>
  );
}
