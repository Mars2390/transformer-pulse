import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { SearchBox } from "@/components/manager/SearchBox";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage() {
  await requireRole("MANAGER", "ADMIN");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/manager/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Search</h1>
        <p className="mt-1 text-sm text-ink-soft">Find any transformer in your region.</p>
      </div>
      <SearchBox />
    </div>
  );
}
