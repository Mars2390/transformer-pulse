"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { IconArrowRight } from "@/components/marketing/icons";

/**
 * Email + 6-digit PIN.
 *
 * The PIN input uses inputMode="numeric", so a phone opens the number keypad
 * rather than the full keyboard. Field engineers sign in one-handed, outdoors,
 * often in gloves — that one attribute is the difference between usable and
 * abandoned.
 */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, pin }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Could not sign you in.");
        setPin(""); // clear the PIN, keep the email — retyping both is punishment
        setBusy(false);
        return;
      }

      // Honour ?next= only when it is a path on this site. Without that check,
      // /login?next=https://evil.example turns our login into an open redirect.
      const next = params.get("next");
      const target =
        next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : data.redirectTo;

      router.push(target);
      router.refresh();
    } catch {
      setError("Network problem. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-semibold text-navy"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@kplc.co.ke"
          className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3.5 text-[15px] text-navy outline-none transition-colors placeholder:text-ink-soft/50 focus:border-kplc focus:ring-4 focus:ring-kplc/10"
        />
      </div>

      <div>
        <label htmlFor="pin" className="block text-sm font-semibold text-navy">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric" // opens the number pad on phones
          autoComplete="current-password"
          required
          maxLength={6}
          value={pin}
          // Strip anything that is not a digit as it is typed, so a stray
          // letter never reaches the server and comes back as a rejection.
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="6 digits"
          className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3.5 text-[15px] tracking-[0.5em] text-navy outline-none transition-colors placeholder:tracking-normal placeholder:text-ink-soft/50 focus:border-kplc focus:ring-4 focus:ring-kplc/10"
        />
      </div>

      {error && (
        // role="alert" so a screen reader announces the failure instead of
        // leaving a blind user staring at a form that silently did nothing.
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || pin.length < 6 || email.length < 3}
        className="group flex w-full items-center justify-center gap-2 rounded-xl bg-kplc px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-kplc/25 transition-all hover:bg-kplc-light disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
      >
        {busy ? "Signing in…" : "Sign in"}
        {!busy && (
          <span className="h-4 w-4 transition-transform group-hover:translate-x-0.5">
            <IconArrowRight />
          </span>
        )}
      </button>
    </form>
  );
}
