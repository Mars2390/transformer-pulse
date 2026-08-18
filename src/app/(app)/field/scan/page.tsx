import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ActionChooser } from "@/components/field/ActionChooser";

export const metadata: Metadata = { title: "Submit a reading" };

export default async function SubmitReadingPage() {
  await requireRole("FIELD_ENGINEER", "ADMIN");

  return (
    <div className="mx-auto max-w-2xl pb-24">
      <Link href="/field/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">← My work</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">Submit a reading</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Find the transformer, then choose what you are doing to it.
      </p>
      <div className="mt-6">
        <ActionChooser />
      </div>
    </div>
  );
}
