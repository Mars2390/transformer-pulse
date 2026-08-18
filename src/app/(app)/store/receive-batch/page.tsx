import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReceiveBatchForm } from "@/components/store/ReceiveBatchForm";

export const metadata: Metadata = { title: "Receive a batch" };
export const dynamic = "force-dynamic";

export default async function ReceiveBatchPage() {
  const user = await requireRole("STORE_KEEPER", "ADMIN");
  const [manufacturers, store] = await Promise.all([
    prisma.manufacturer.findMany({ select: { id: true, name: true, country: true }, orderBy: { name: "asc" } }),
    user.storeId ? prisma.store.findUnique({ where: { id: user.storeId } }) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/store/dashboard" className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft hover:text-kplc">
          ← Store
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Receive a batch</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          A whole delivery at once, with the sample you are going to test marked as you go. KPLC
          tests a few and releases the rest on them — this records that honestly instead of
          pretending every unit was proved.
        </p>
      </div>
      <ReceiveBatchForm manufacturers={manufacturers} storeName={store?.name ?? "your store"} />
    </div>
  );
}
