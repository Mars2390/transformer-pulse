import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { ChainVerifier } from "@/components/admin/ChainVerifier";

export const metadata: Metadata = { title: "Chain verification" };

export default async function ChainPage() {
  await requireRole("ADMIN");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Chain verification</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Recompute every transformer&apos;s custody chain from scratch. This is the
          arithmetic behind the claim that the register is untampered — run it live,
          in front of anyone who doubts it.
        </p>
      </div>

      <ChainVerifier />

      <div className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-navy">How to demonstrate a tamper</h2>
        <ol className="mt-3 list-inside list-decimal space-y-1.5 text-sm text-ink-soft">
          <li>Verify all chains — everything is green.</li>
          <li>Open Prisma Studio and edit the notes on any past event.</li>
          <li>Verify again — that transformer turns red and names the broken event.</li>
          <li>Restore the note — verify once more, and it is green again.</li>
        </ol>
      </div>
    </div>
  );
}
