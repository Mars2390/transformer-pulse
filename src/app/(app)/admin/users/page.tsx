import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UsersManager, type AdminUser } from "@/components/admin/UsersManager";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const actor = await requireRole("ADMIN");

  const [users, stores] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
      include: {
        store: { select: { name: true } },
        _count: { select: { events: true, tests: true, claimsRaised: true } },
      },
    }),
    prisma.store.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, region: true } }),
  ]);

  const regions = [...new Set(stores.map((s) => s.region))].sort();

  const rows: AdminUser[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    region: u.region,
    storeName: u.store?.name ?? null,
    active: u.active,
    locked: !!(u.lockedUntil && u.lockedUntil > new Date()),
    lastLoginISO: u.lastLoginAt?.toISOString() ?? null,
    eventCount: u._count.events + u._count.tests + u._count.claimsRaised,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">Users</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Role decides access — not the email. {rows.length} accounts.
        </p>
      </div>
      <UsersManager users={rows} stores={stores} regions={regions} currentUserId={actor.id} />
    </div>
  );
}
