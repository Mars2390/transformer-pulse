import Link from "next/link";
import { BrandLockup } from "@/components/brand/KplcLogo";

const COLUMNS = [
  {
    title: "PLATFORM",
    links: [
      { label: "Capabilities", href: "#capabilities" },
      { label: "Lifecycle", href: "#lifecycle" },
      { label: "How it works", href: "#how" },
      { label: "Open dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "FOR FIELD TEAMS",
    links: [
      { label: "Record an installation", href: "/field" },
      { label: "Report a fault", href: "/field" },
      { label: "Look up a transformer", href: "/transformers" },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-navy-dark text-white">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr]">
          {/* --- Brand ----------------------------------------------------- */}
          <div>
            <BrandLockup tone="light" />
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/55">
              Lifecycle tracking for distribution transformers — from the
              manufacturer, through the store, to the pole.
            </p>
          </div>

          {/* --- Link columns ---------------------------------------------- */}
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-bold tracking-[0.14em] text-white/40">
                {column.title}
              </p>
              <ul className="mt-5 space-y-3.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/70 transition-colors hover:text-gold"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* --- Copyright bar ---------------------------------------------------
          The Kenyan flag colours appear once, as a 3px rule. Any more and a
          national flag becomes decoration, which reads as disrespectful. */}
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-xs text-white/45">
            © {new Date().getFullYear()} Transformer Pulse
          </p>

          <div className="flex h-[3px] w-24 overflow-hidden rounded-full" aria-hidden="true">
            <span className="flex-1 bg-black" />
            <span className="flex-1 bg-[#bb0000]" />
            <span className="flex-1 bg-white" />
            <span className="flex-1 bg-[#006600]" />
          </div>
        </div>
      </div>
    </footer>
  );
}
