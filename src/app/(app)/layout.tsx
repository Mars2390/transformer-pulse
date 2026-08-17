import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/app/AppShell";
import { FieldBottomNav } from "@/components/field/FieldBottomNav";
import { AlertBell } from "@/components/manager/AlertBell";
import { ToastProvider } from "@/components/ui/Toast";
import { NAV_SECTIONS, QUICK_LINKS } from "@/lib/nav";
import { ROLE_LABELS } from "@/lib/format";

/**
 * The shell every signed-in page sits inside.
 *
 * `requireUser()` here is the real security boundary — middleware only
 * redirects, and a cookie is client-controlled. This runs on the server, on
 * every request, and cannot be skipped by editing anything in a browser.
 *
 * The navigation itself moved to src/lib/nav.ts and the chrome to AppShell.
 * That split exists because the nav needs `usePathname` to mark the current
 * page, which makes it a client component, while the auth check must stay on
 * the server. Keeping them in one file would have meant shipping either the
 * auth check to the browser or a nav that cannot tell you where you are.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isField = user.role === "FIELD_ENGINEER";

  // Two initials for the avatar — "Grace Wanjiru" becomes GW.
  const initials = user.name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <AppShell
      sections={NAV_SECTIONS[user.role] ?? []}
      quickLinks={QUICK_LINKS[user.role] ?? []}
      user={{
        name: user.name,
        roleLabel: ROLE_LABELS[user.role],
        region: user.region ?? null,
        initials,
      }}
      // STORE_MANAGER was omitted here, so the one role that has an approval
      // queue and a store to run had no way of being told anything was in it.
      bell={
        user.role === "MANAGER" || user.role === "STORE_MANAGER" || user.role === "ADMIN" ? (
          <AlertBell />
        ) : null
      }
      // Field engineers keep the fixed bottom bar — it is where a thumb rests,
      // and it is faster than the drawer for the four things they do all day.
      bottomNav={isField ? <FieldBottomNav /> : null}
    >
      <div className={isField ? "pb-20 lg:pb-0" : ""}>
        <ToastProvider>{children}</ToastProvider>
      </div>
    </AppShell>
  );
}
