import Link from "next/link";
import type { Tone } from "@/lib/format";

/** The shared UI kit. Small, boring, and used everywhere. */

// --- Card -------------------------------------------------------------------

export function Card({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** Set when the card is the target of an in-page anchor link. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`rounded-2xl border border-line bg-white shadow-sm shadow-navy/4 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
      <h2 className="text-sm font-bold text-navy">{title}</h2>
      {action}
    </div>
  );
}

// --- Badge ------------------------------------------------------------------

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-soft ring-line",
  info: "bg-kplc/8 text-kplc ring-kplc/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

// --- Stat tile --------------------------------------------------------------

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  href?: string;
}) {
  const accent: Record<Tone, string> = {
    neutral: "text-navy",
    info: "text-kplc",
    success: "text-emerald-600",
    warning: "text-amber-600",
    danger: "text-red-600",
  };

  const body = (
    <>
      <p className="text-[11px] font-bold tracking-[0.1em] text-ink-soft">
        {label.toUpperCase()}
      </p>
      <p className={`mt-2 text-3xl font-extrabold tracking-tight ${accent[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </>
  );

  const shell =
    "block rounded-2xl border border-line bg-white p-5 shadow-sm shadow-navy/4 transition-all";

  return href ? (
    <Link href={href} className={`${shell} hover:-translate-y-0.5 hover:border-kplc/40 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

// --- Empty state ------------------------------------------------------------

export function EmptyState({ message }: { message: string }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-ink-soft">{message}</p>
  );
}

// --- Buttons ----------------------------------------------------------------

export function ActionLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "gold";
  className?: string;
}) {
  const variants = {
    primary:
      "bg-kplc text-white shadow-lg shadow-kplc/20 hover:bg-kplc-light",
    secondary:
      "border border-line bg-white text-navy hover:border-navy/30 hover:shadow-md",
    gold: "bg-gold text-navy-dark shadow-lg shadow-gold/20 hover:bg-gold-dark",
  };

  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-all hover:-translate-y-0.5 ${variants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
