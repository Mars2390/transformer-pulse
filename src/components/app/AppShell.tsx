"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KplcMark } from "@/components/brand/KplcLogo";
import { LogoutButton } from "@/components/app/LogoutButton";
import type { NavLink, NavSection } from "@/lib/nav";

/**
 * The signed-in chrome: a grouped rail on a wide screen, a drawer on a phone.
 *
 * What this replaces, and why
 * ---------------------------
 * The old header put every link for a role in one horizontal row, next to the
 * name, role, region, alert bell, avatar and sign-out button. A regional
 * manager has a dozen links. On a laptop they did not fit, so they wrapped
 * underneath and ran into the user block — the overlapping text in the header.
 *
 * Raising the breakpoint would have hidden that until somebody with a longer
 * name or a longer region signed in. The structural fix is to stop making links
 * compete for horizontal space at all. On lg and up they live in a vertical
 * rail, where a thirteenth link costs nothing. Below that they are behind one
 * button, which is the only honest way to fit thirteen things on a phone.
 *
 * Sign-out appears in three places on purpose — the header, the bottom of the
 * rail, and the bottom of the drawer. Duplicating a control is normally a smell;
 * here it is the point. A shared depot PC that somebody cannot work out how to
 * sign out of is a shared depot PC left signed in, and the next person inherits
 * a manager's approvals screen.
 */
export function AppShell({
  sections,
  quickLinks,
  user,
  bell,
  children,
  bottomNav,
}: {
  sections: NavSection[];
  quickLinks: NavLink[];
  user: { name: string; roleLabel: string; region: string | null; initials: string };
  bell?: React.ReactNode;
  children: React.ReactNode;
  bottomNav?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation. Without this it stays open over the page it
  // just opened, which on a phone looks like the tap did nothing.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // A drawer that swallows Escape is a drawer somebody gets stuck behind.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href + "/"));

  const railLink = (link: NavLink) => (
    <Link
      key={link.href}
      href={link.href}
      className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
        isActive(link.href)
          ? "bg-kplc/10 font-bold text-navy"
          : "font-medium text-ink-soft hover:bg-surface-2 hover:text-navy"
      }`}
    >
      {link.label}
    </Link>
  );

  const nav = (
    <nav className="space-y-5" aria-label="Main">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-soft">
            {section.title}
          </p>
          <div className="space-y-0.5">{section.links.map(railLink)}</div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-svh bg-surface">
      {/* ---- Header ---------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-navy hover:bg-surface-2 lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>

          <Link href="/dashboard" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5">
            <KplcMark className="h-9 w-9" />
            <span className="hidden text-[15px] font-extrabold tracking-tight text-navy sm:block">
              Transformer<span className="text-gold">DNA</span>
            </span>
          </Link>

          {/* Two or three shortcuts only. The rail holds the rest, so nothing
              here has to shrink when a role gains a screen. */}
          <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Shortcuts">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive(link.href)
                    ? "bg-surface-2 font-bold text-navy"
                    : "font-medium text-ink-soft hover:bg-surface-2 hover:text-navy"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {bell}
            {/* min-w-0 + truncate: a long name now shortens with an ellipsis
                instead of pushing the avatar and sign-out off the row. */}
            <div className="hidden min-w-0 max-w-[180px] text-right md:block">
              <p className="truncate text-sm font-semibold leading-tight text-navy">{user.name}</p>
              <p className="truncate text-[11px] leading-tight text-ink-soft">
                {user.roleLabel}
                {user.region ? ` · ${user.region}` : ""}
              </p>
            </div>
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-kplc text-xs font-bold text-white"
              aria-hidden="true"
            >
              {user.initials}
            </span>
            <LogoutButton className="hidden sm:inline-flex" />
          </div>
        </div>
      </header>

      {/* ---- Rail + page ------------------------------------------------ */}
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-16 hidden h-[calc(100svh-4rem)] w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-white px-3 py-5 lg:flex">
          {nav}
          <div className="mt-auto border-t border-line pt-3">
            <LogoutButton className="w-full text-left" />
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>

      {/* ---- Mobile drawer ---------------------------------------------- */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-navy/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-navy">{user.name}</p>
                <p className="truncate text-[11px] text-ink-soft">
                  {user.roleLabel}
                  {user.region ? ` · ${user.region}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-surface-2"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 px-3 py-4">{nav}</div>

            <div className="border-t border-line px-3 py-3">
              <LogoutButton className="w-full text-left" />
            </div>
          </div>
        </div>
      )}

      {bottomNav}
    </div>
  );
}
