import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, StatTile, Badge, EmptyState } from "@/components/ui";
import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { formatDate, formatNumber, ROLE_LABELS } from "@/lib/format";
import type { Role } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

const ROLE_TONE: Record<Role, "info" | "success" | "warning" | "neutral"> = {
  ADMIN: "warning",
  MANAGER: "info",
  STORE_KEEPER: "neutral",
  FIELD_ENGINEER: "success",
};

export default async function AdminDashboard() {
  await requireRole("ADMIN");

  const [users, stores, manufacturers, transformerCount] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      include: { store: { select: { name: true } } },
    }),
    prisma.store.findMany({ orderBy: { name: "asc" } }),
    prisma.manufacturer.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { transformers: true, claims: true } } },
    }),
    prisma.transformer.count(),
  ]);

  const regions = [...new Set(stores.map((s) => s.region))].sort();
  const lockedOut = users.filter(
    (u) => u.lockedUntil && u.lockedUntil > new Date(),
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy">
          Administration
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Accounts, stores and manufacturers.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Users" value={formatNumber(users.length)} tone="info" />
        <StatTile label="Stores" value={formatNumber(stores.length)} />
        <StatTile label="Manufacturers" value={formatNumber(manufacturers.length)} />
        <StatTile
          label="Locked out"
          value={formatNumber(lockedOut)}
          tone={lockedOut ? "danger" : "neutral"}
          hint={lockedOut ? "Too many failed PINs" : "None"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Users -------------------------------------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader title={`Staff accounts (${users.length})`} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-[11px] font-bold tracking-wide text-ink-soft">
                <tr>
                  <th className="px-5 py-3">NAME</th>
                  <th className="px-5 py-3">ROLE</th>
                  <th className="px-5 py-3">REGION</th>
                  <th className="px-5 py-3">ADDED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {users.map((user) => {
                  const locked = user.lockedUntil && user.lockedUntil > new Date();
                  return (
                    <tr key={user.id} className="hover:bg-surface">
                      <td className="px-5 py-3">
                        <p className="font-semibold text-navy">{user.name}</p>
                        <p className="text-xs text-ink-soft">{user.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={ROLE_TONE[user.role]}>
                          {ROLE_LABELS[user.role]}
                        </Badge>
                        {locked && (
                          <span className="ml-1.5">
                            <Badge tone="danger">Locked</Badge>
                          </span>
                        )}
                        {!user.active && (
                          <span className="ml-1.5">
                            <Badge tone="neutral">Disabled</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-ink-soft">
                        {user.region ?? "—"}
                        {user.store ? ` · ${user.store.name}` : ""}
                      </td>
                      <td className="px-5 py-3 text-xs text-ink-soft">
                        {formatDate(user.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* --- Create user -------------------------------------------------- */}
        <Card className="p-5">
          <h2 className="text-sm font-bold text-navy">Create an account</h2>
          <p className="mt-1 text-xs text-ink-soft">
            The new user signs in with their email and this PIN.
          </p>
          <div className="mt-5">
            <CreateUserForm stores={stores} regions={regions} />
          </div>
        </Card>
      </div>

      {/* --- Manufacturers ---------------------------------------------------- */}
      <Card>
        <CardHeader title={`Manufacturers (${manufacturers.length})`} />
        {manufacturers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-[11px] font-bold tracking-wide text-ink-soft">
                <tr>
                  <th className="px-5 py-3">NAME</th>
                  <th className="px-5 py-3">COUNTRY</th>
                  <th className="px-5 py-3">WARRANTY</th>
                  <th className="px-5 py-3">UNITS</th>
                  <th className="px-5 py-3">CLAIMS</th>
                  <th className="px-5 py-3">CONTACT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {manufacturers.map((m) => (
                  <tr key={m.id} className="hover:bg-surface">
                    <td className="px-5 py-3 font-semibold text-navy">{m.name}</td>
                    <td className="px-5 py-3 text-ink-soft">{m.country ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-soft">{m.warrantyMonths} months</td>
                    <td className="px-5 py-3 font-semibold text-navy">
                      {m._count.transformers}
                    </td>
                    <td className="px-5 py-3">
                      {m._count.claims > 0 ? (
                        <Badge tone="warning">{m._count.claims}</Badge>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-soft">
                      {m.contactEmail ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No manufacturers yet." />
        )}
        <p className="border-t border-line px-5 py-3 text-xs text-ink-soft">
          {formatNumber(transformerCount)} transformers on the register.
        </p>
      </Card>
    </div>
  );
}
