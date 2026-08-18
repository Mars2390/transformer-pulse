import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReceiveForm } from "@/components/store/ReceiveForm";

export const metadata: Metadata = { title: "Receive a transformer" };
export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const user = await requireRole("STORE_KEEPER", "ADMIN");

  const [manufacturers, store] = await Promise.all([
    prisma.manufacturer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, warrantyMonths: true },
    }),
    user.storeId
      ? prisma.store.findUnique({ where: { id: user.storeId } })
      : null,
  ]);

  if (!store) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-lg font-bold text-amber-900">No store assigned</h1>
        <p className="mt-2 text-sm text-amber-800">
          Your account is not linked to a store, so there is nowhere to receive a
          transformer into. Ask an administrator to assign you one.
        </p>
        <Link
          href="/store/dashboard"
          className="mt-4 inline-block text-sm font-bold text-kplc hover:underline"
        >
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/store/dashboard"
        className="inline-flex min-h-11 min-w-11 items-center text-xs font-bold text-ink-soft transition-colors hover:text-kplc"
      >
        ← Store
      </Link>

      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-navy">
        Receive a transformer
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        Into {store.name}. This creates the transformer and the first entry in
        its story.
      </p>

      <div className="mt-6">
        <ReceiveForm manufacturers={manufacturers} storeName={store.name} />
      </div>
    </div>
  );
}
