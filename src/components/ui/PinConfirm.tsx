"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormError, inputClass } from "@/components/ui/Field";

/**
 * The PIN box that stands between a queue and a signature.
 *
 * requirePinConfirmation() spends the PIN again on the server at the moment of
 * signature, because a session cookie only proves somebody signed in on this
 * device within the last twelve hours — not that the person now clicking
 * "Approve" is that somebody. This component is the other half of that control.
 * Without a box to type it into, the server's requirement is not a control at
 * all: it is a 422 on every decision, and the queue simply stops working.
 *
 * The PIN is held HERE, not in the parent. It lives in state that is thrown away
 * the moment the dialog closes and is handed to the caller as an argument, so no
 * screen above this one ever holds it, and it cannot survive into a re-render,
 * a draft, or a second decision.
 *
 * type="password" with autoComplete="off": a PIN the browser offers back from
 * its saved-password store would let an unattended laptop in a depot sign for a
 * transformer, which is the exact thing the re-verification exists to stop.
 */
export function PinConfirm({
  open,
  title,
  summary,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** One sentence naming exactly what is about to be signed. */
  summary: string;
  confirmLabel: string;
  busy: boolean;
  /** The server's refusal — a wrong PIN, or the throttle on APPROVAL_PIN. */
  error: string | null;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Cleared on every open, so one dialog's PIN never survives into the next,
  // and focused, because on a phone this dialog exists only to be typed into.
  useEffect(() => {
    if (!open) return;
    setPin("");
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const complete = /^\d{6}$/.test(pin);

  function submit() {
    if (!complete || busy) return;
    onConfirm(pin);
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onCancel} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">{summary}</p>

        <div>
          <label htmlFor="signature-pin" className="block text-xs font-bold text-navy">
            Your 6-digit PIN
          </label>
          <input
            ref={inputRef}
            id="signature-pin"
            name="signature-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            // Non-digits are stripped rather than refused. A space pasted in from
            // a message would otherwise fail validation with nothing on screen
            // to explain why.
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className={`${inputClass} mt-1.5 text-center text-lg tracking-[0.4em]`}
            disabled={busy}
          />
          <p className="mt-1 text-xs text-ink-soft">
            The same PIN you sign in with. It is checked again here so an unattended
            screen cannot sign on your behalf.
          </p>
        </div>

        {error && <FormError message={error} />}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-lg border border-line bg-white px-4 py-2 text-xs font-bold text-ink-soft disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!complete || busy}
            className="min-h-11 rounded-lg bg-kplc px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-ink-soft/40"
          >
            {busy ? "Signing…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
