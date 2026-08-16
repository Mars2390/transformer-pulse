import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { QrScanner } from "@/components/field/QrScanner";

export const metadata: Metadata = { title: "Scan a tag" };
export const dynamic = "force-dynamic";

export default async function QrScanPage() {
  await requireUser();
  const setting = await prisma.appSetting.findUnique({ where: { id: "singleton" } });

  return (
    <div className="mx-auto max-w-md space-y-5 pb-24">
      <div>
        <Link href="/field/dashboard" className="text-xs font-bold text-ink-soft hover:text-kplc">
          ← My work
        </Link>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Scan a tag</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Point the camera at the QR label on the transformer to open its full history.
        </p>
      </div>
      <QrScanner usingDefaultPin={!setting?.qrAccessPinHash} />
    </div>
  );
}
