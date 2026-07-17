import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader } from "@/components/ui";
import { InventoryTable, type InventoryRow } from "@/components/store/InventoryTable";
import { computeWarranty, warrantyLabel } from "@/lib/warranty";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Transformers" };
export const dynamic = "force-dynamic";

export default async function TransformersPage() {
  const user = await requireUser();

  // Everyone sees transformers, but scoped to their patch. A field engineer or
  // manager sees their region; a store keeper sees their store's region; an
  // admin sees everything.
  const where: Prisma.TransformerWhereInput =
    user.role === "ADMIN"
      ? {}
      : user.region
        ? { region: user.region }
        : user.storeId
          ? { currentStoreId: user.storeId }
          : {};

  const transformers = await prisma.transformer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      manufacturer: { select: { name: true } },
      currentStore: { select: { name: true } },
      tests: {
        where: { stage: "STORE_INTAKE" },
        orderBy: { testedAt: "desc" },
        take: 1,
        select: { passed: true },
      },
    },
  });

  const rows: InventoryRow[] = transformers.map((tx) => {
    const warranty = computeWarranty(tx.warrantyStart, tx.warrantyMonths);
    return {
      id: tx.id,
      gNumber: tx.gNumber,
      serialNumber: tx.serialNumber,
      manufacturer: tx.manufacturer.name,
      ratingKva: tx.ratingKva,
      status: tx.status,
      testState:
        tx.tests.length === 0 ? "UNTESTED" : tx.tests[0].passed ? "PASSED" : "FAILED",
      warrantyLabel: warrantyLabel(warranty),
      warrantyState: warranty.state,
      location: tx.currentSiteName ?? tx.currentStore?.name ?? "—",
      receivedAt: tx.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Transformers</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {user.role === "ADMIN" ? "Every transformer on the register" : user.region ?? "Your area"}
          {" · "}
          {rows.length} unit{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardHeader title="All transformers" />
        <InventoryTable rows={rows} />
      </Card>
    </div>
  );
}
