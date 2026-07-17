"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconClipboard,
  IconPin,
  IconCamera,
} from "@/components/marketing/icons";

/**
 * Fixed bottom navigation for the field engineer. Thumb-reachable, four large
 * targets, hidden on desktop where the top nav does the job.
 */
const ITEMS = [
  { href: "/field/dashboard", label: "Home", icon: IconClipboard },
  { href: "/field/scan", label: "Submit", icon: IconCamera },
  { href: "/field/map", label: "Map", icon: IconPin },
  { href: "/transformers", label: "Look up", icon: IconClipboard },
];

export function FieldBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-white/95 backdrop-blur-md md:hidden"
      aria-label="Field navigation"
    >
      {ITEMS.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/field/dashboard" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
              active ? "text-kplc" : "text-ink-soft"
            }`}
          >
            <span className="h-5 w-5">
              <Icon />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
