"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandLockup } from "@/components/brand/KplcLogo";

const LINKS = [
  { href: "#capabilities", label: "Capabilities" },
  { href: "#lifecycle", label: "Lifecycle" },
  { href: "#network", label: "Network" },
  { href: "#how", label: "How it works" },
];

export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // Transparent over the hero, solid once scrolled — so the brand never sits
  // on a busy photograph.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll behind the open drawer.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled || open
          ? "border-b border-white/10 bg-navy-dark/85 shadow-lg shadow-navy-dark/20 backdrop-blur-xl"
          : "border-b border-transparent bg-gradient-to-b from-navy-dark/50 to-transparent"
      }`}
    >
      <nav
        className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8"
        aria-label="Main"
      >
        <Link href="/" onClick={() => setOpen(false)} className="rounded-lg">
          <BrandLockup tone="light" />
        </Link>

        {/* --- Desktop ------------------------------------------------------ */}
        <div className="hidden items-center gap-8 lg:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-white/70 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}

          <span className="h-5 w-px bg-white/15" aria-hidden="true" />

          <Link
            href="/login"
            className="text-sm font-semibold text-white/85 transition-colors hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-navy-dark shadow-lg shadow-gold/20 transition-all hover:-translate-y-0.5 hover:bg-gold-dark hover:shadow-gold/30"
          >
            Open dashboard
          </Link>
        </div>

        {/* --- Mobile toggle ------------------------------------------------ */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-11 w-11 place-items-center rounded-lg border border-white/15 bg-white/5 text-white lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-drawer"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          <span className="relative block h-4 w-5">
            <span
              className={`absolute left-0 h-0.5 w-5 rounded bg-current transition-all duration-300 ${
                open ? "top-[7px] rotate-45" : "top-0"
              }`}
            />
            <span
              className={`absolute left-0 top-[7px] h-0.5 w-5 rounded bg-current transition-opacity duration-200 ${
                open ? "opacity-0" : "opacity-100"
              }`}
            />
            <span
              className={`absolute left-0 h-0.5 w-5 rounded bg-current transition-all duration-300 ${
                open ? "top-[7px] -rotate-45" : "top-[14px]"
              }`}
            />
          </span>
        </button>
      </nav>

      {/* --- Mobile drawer -------------------------------------------------- */}
      <div
        id="mobile-drawer"
        className={`overflow-hidden border-t border-white/10 bg-navy-dark transition-[max-height] duration-400 ease-out lg:hidden ${
          open ? "max-h-[420px]" : "max-h-0 border-t-transparent"
        }`}
      >
        <div className="px-5 pb-7 pt-3">
          <div className="flex flex-col">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3.5 text-base font-medium text-white/75 transition-colors hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-white/20 px-4 py-3.5 text-center text-sm font-semibold text-white"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="rounded-xl bg-gold px-4 py-3.5 text-center text-sm font-bold text-navy-dark"
            >
              Open dashboard
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
