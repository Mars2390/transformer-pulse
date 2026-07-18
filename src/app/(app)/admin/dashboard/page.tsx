import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StatTile, ActionLink } from "@/components/ui";
import { formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireRole("ADMIN");

  const [users, lockedOut, manufacturers, stores, transformers, auditCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { lockedUntil: { gt: new Date() } } }),
    prisma.manufacturer.count(),
    prisma.store.count(),
    prisma.transformer.count(),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Administration</h1>
        <p className="mt-1 text-sm text-ink-soft">Everything that configures the system.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Users" value={formatNumber(users)} tone="info" href="/admin/users" />
        <StatTile label="Locked out" value={formatNumber(lockedOut)} tone={lockedOut ? "danger" : "neutral"} hint={lockedOut ? "Too many failed PINs" : "None"} href="/admin/users" />
        <StatTile label="Manufacturers" value={formatNumber(manufacturers)} href="/admin/manufacturers" />
        <StatTile label="Stores" value={formatNumber(stores)} href="/admin/stores" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Section title="Users" body="Create accounts, reset PINs, disable or unlock. Role decides access." href="/admin/users" cta="Manage users" />
        <Section title="Manufacturers" body="Suppliers and their warranty terms." href="/admin/manufacturers" cta="Manage manufacturers" />
        <Section title="Stores" body="KPLC warehouses that receive and dispatch." href="/admin/stores" cta="Manage stores" />
        <Section title="Audit log" body={`${auditCount} administrative actions recorded.`} href="/admin/audit" cta="View audit log" />
        <Section title="Chain verification" body={`Verify every custody chain across ${transformers} transformers.`} href="/admin/chain" cta="Verify chains" />
        <Section title="Transformers" body="The full register, across every region." href="/transformers" cta="Browse transformers" />
      </div>
    </div>
  );
}

function Section({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-white p-5">
      <h2 className="text-sm font-bold text-navy">{title}</h2>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-ink-soft">{body}</p>
      <div className="mt-4">
        <ActionLink href={href} variant="secondary">{cta}</ActionLink>
      </div>
    </div>
  );
}
