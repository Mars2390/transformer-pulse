"use client";

import { useState } from "react";
import { Field, inputClass } from "@/components/ui/Field";

/**
 * Changing the shared PIN that guards the in-app QR scanner.
 *
 * The banner is not decoration. A four-digit PIN shared across a depot has no
 * accountability — it identifies nobody, and within a week of issue everybody
 * knows it, including people who have left. An administrator setting it should
 * see that stated plainly on the screen where they set it, rather than
 * believing they have just secured something.
 *
 * The control that actually works is already in place: the full record requires
 * a KPLC sign-in, so a scanned label shows a stranger a public summary and
 * nothing else.
 */
export function QrPinSettings({ usingDefault }: { usingDefault: boolean }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!/^\d{4}$/.test(pin)) {
      setMsg({ ok: false, text: "The PIN must be exactly four digits." });
      return;
    }
    if (pin !== confirm) {
      setMsg({ ok: false, text: "The two PINs do not match." });
      return;
    }
    // Refused rather than warned about. A PIN of 0000 or 1234 is the one
    // everybody guesses first, and a warning somebody can click past is a
    // warning everybody clicks past.
    if (["0000", "1234", "1111", "2222", "9999"].includes(pin)) {
      setMsg({ ok: false, text: "That PIN is one of the first anybody tries. Choose another." });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/settings/qr-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error ?? "Could not save that PIN." });
        return;
      }
      setPin("");
      setConfirm("");
      setMsg({
        ok: true,
        text: "PIN updated. Tell the field teams — the old one stopped working just now.",
      });
    } catch {
      setMsg({ ok: false, text: "No connection. The PIN was not changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="text-sm font-extrabold text-navy">QR scanner PIN</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Typed once before the in-app QR scanner opens. Stored hashed, so it cannot be read back out
        of the database or out of a backup — if it is forgotten, it is replaced here, not recovered.
      </p>

      {usingDefault && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">
          ⚠️ Still on the factory default, <span className="font-mono">0000</span>. That is
          documented in the manual, which means it is public. Change it before the field teams start
          scanning.
        </p>
      )}

      <p className="mt-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        Worth being clear about what this does. A shared PIN tells you that somebody knew the
        number, never <em>who</em>. Treat it as a deterrent on the scanner, not as access control.
        The control that holds is the sign-in on the full record: a label on a pole gets a passer-by
        a public summary with no names, no readings and no location.
      </p>

      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="New PIN" htmlFor="qrpin">
          <input
            id="qrpin"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            className={`${inputClass} font-mono tracking-[0.4em]`}
          />
        </Field>
        <Field label="Confirm PIN" htmlFor="qrpin2">
          <input
            id="qrpin2"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            className={`${inputClass} font-mono tracking-[0.4em]`}
          />
        </Field>

        {msg && (
          <p
            className={`sm:col-span-2 rounded-xl px-3 py-2 text-xs font-semibold ${
              msg.ok
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {msg.text}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-kplc px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Change PIN"}
          </button>
        </div>
      </form>
    </section>
  );
}
