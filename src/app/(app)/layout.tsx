import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { KplcMark } from "@/components/brand/KplcLogo";
import { LogoutButton } from "@/components/app/LogoutButton";
import { FieldBottomNav } from "@/components/field/FieldBottomNav";
import { AlertBell } from "@/components/manager/AlertBell";
import { ToastProvider } from "@/components/ui/Toast";
import { ROLE_LABELS } from "@/lib/format";
import type { Role } from "@/generated/prisma/enums";

/**
 * The shell every signed-in page sits inside.
 *
 * `requireUser()` here is the real security boundary — middleware only
 * redirects, and a cookie is client-controlled. This runs on the server, on
 * every request, and cannot be skipped by editing anything in a browser.
 */

const NAV: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: "/admin/dashboard", label: "Overview" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/manufacturers", label: "Manufacturers" },
    { href: "/admin/stores", label: "Stores" },
    { href: "/admin/audit", label: "Audit" },
    { href: "/admin/chain", label: "Chain" },
  ],
  MANAGER: [
    { href: "/manager/dashboard", label: "Dashboard" },
    { href: "/manager/map", label: "Map" },
    { href: "/manager/warranty", label: "Warranty" },
    { href: "/manager/reports", label: "Reports" },
    { href: "/manager/search", label: "Search" },
  ],
  STORE_KEEPER: [
    { href: "/store/dashboard", label: "Store" },
    { href: "/transformers", label: "Transformers" },
  ],
  FIELD_ENGINEER: [
    { href: "/field/dashboard", label: "My work" },
    { href: "/transformers", label: "Transformers" },
  ],
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const links = NAV[user.role] ?? [];
  const isField = user.role === "FIELD_ENGINEER";

  // Two initials for the avatar — "Grace Wanjiru" becomes GW.
  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="min-h-svh bg-surface">
      <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <KplcMark className="h-9 w-9" />
              <span className="hidden text-[15px] font-extrabold tracking-tight text-navy sm:block">
                Transformer<span className="text-gold">Pulse</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-navy"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {(user.role === "MANAGER" || user.role === "ADMIN") && <AlertBell />}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold leading-tight text-navy">
                {user.name}
              </p>
              <p className="text-[11px] leading-tight text-ink-soft">
                {ROLE_LABELS[user.role]}
                {user.region ? ` · ${user.region}` : ""}
              </p>
            </div>
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-kplc text-xs font-bold text-white"
              aria-hidden="true"
            >
              {initials}
            </span>
            <LogoutButton />
          </div>
        </div>

        {/* Mobile nav — the desktop links have nowhere to go on a phone. */}
        {/* Field engineers get a fixed BOTTOM nav instead of this top strip —
            it is where a thumb rests. Every other role keeps the top strip. */}
        {!isField && (
          <nav
            className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden"
            aria-label="Main"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-2 hover:text-navy"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main
        className={`mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 ${
          isField ? "pb-24 md:pb-8" : ""
        }`}
      >
        <ToastProvider>{children}</ToastProvider>
      </main>

      {isField && <FieldBottomNav />}
    </div>
  );
}
