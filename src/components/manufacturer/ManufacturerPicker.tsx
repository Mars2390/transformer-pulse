"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inputClass } from "@/components/ui/Field";

export type PickerManufacturer = { id: string; name: string; country?: string | null };

/**
 * Choosing a manufacturer, and adding one when it is not there yet.
 *
 * A native <select> was fine when the list was five suppliers. It stops being
 * fine on a phone with thirty, and it fails completely the first time a lorry
 * turns up from a supplier nobody has entered — at which point the keeper's
 * only options are to guess, to pick "Unknown", or to stop and telephone an
 * administrator. All three end with a wrong record.
 *
 * So: type to filter, and if nothing matches, add it right here. The new
 * supplier is created immediately and selected, because a half-finished receipt
 * abandoned to go and configure something is a receipt that never happens.
 *
 * Deliberately built on a plain text input and a list rather than a combobox
 * library: it has to work with a thumb, in a yard, on a cheap Android browser.
 */
export function ManufacturerPicker({
  manufacturers,
  value,
  onChange,
  onCreated,
  name,
  required,
  disabled,
}: {
  manufacturers: PickerManufacturer[];
  value: string;
  onChange: (id: string) => void;
  /** Called with the newly created supplier so the parent can add it to its list. */
  onCreated?: (created: PickerManufacturer) => void;
  /** Renders a hidden input so this works inside a plain <form> submission. */
  name?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newCountry, setNewCountry] = useState("");
  const [newWarranty, setNewWarranty] = useState("24");
  const [newContact, setNewContact] = useState("");

  const boxRef = useRef<HTMLDivElement>(null);

  const selected = manufacturers.find((m) => m.id === value) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return manufacturers;
    return manufacturers.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.country ?? "").toLowerCase().includes(q),
    );
  }, [manufacturers, query]);

  // Close on an outside tap. On a phone there is no Escape key to fall back on.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  async function createManufacturer() {
    const trimmed = newName.trim();
    if (trimmed.length < 2) {
      setError("Enter the manufacturer's name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manufacturers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          country: newCountry.trim() || undefined,
          warrantyMonths: Number(newWarranty) || 24,
          contactName: newContact.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not add that manufacturer.");
        return;
      }
      const created: PickerManufacturer = data.manufacturer;
      onCreated?.(created);
      onChange(created.id);
      setQuery("");
      setAdding(false);
      setOpen(false);
      setNewName("");
      setNewCountry("");
      setNewContact("");
      setNewWarranty("24");
    } catch {
      setError("No connection. The manufacturer was not added.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      {name && <input type="hidden" name={name} value={value} />}

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex w-full items-center justify-between text-left ${
          selected ? "text-ink" : "text-ink-soft"
        }`}
      >
        <span className="truncate">
          {selected ? selected.name : "Choose manufacturer…"}
          {selected?.country ? <span className="text-ink-soft"> · {selected.country}</span> : null}
        </span>
        <span className="ml-2 shrink-0 text-ink-soft">{open ? "▲" : "▼"}</span>
      </button>
      {required && !value && (
        <p className="mt-1 text-[11px] font-semibold text-amber-700">Required.</p>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-white shadow-xl">
          {!adding ? (
            <>
              <div className="border-b border-line p-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Type to filter — TE finds TELK"
                  className={`${inputClass} py-2 text-sm`}
                />
              </div>

              <ul className="max-h-56 overflow-y-auto">
                {matches.length === 0 && (
                  <li className="px-3 py-3 text-xs text-ink-soft">
                    Nothing matches “{query}”.
                  </li>
                )}
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-surface ${
                        m.id === value ? "bg-kplc/5 font-bold text-navy" : "text-ink"
                      }`}
                    >
                      <span className="truncate">{m.name}</span>
                      {m.country && <span className="ml-2 shrink-0 text-xs text-ink-soft">{m.country}</span>}
                    </button>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setNewName(query.trim());
                  setError(null);
                }}
                className="w-full border-t border-line bg-surface px-3 py-3 text-left text-sm font-bold text-kplc hover:bg-surface-2"
              >
                + Add new manufacturer{query.trim() ? ` “${query.trim()}”` : ""}
              </button>
            </>
          ) : (
            <div className="space-y-2 p-3">
              <p className="text-xs font-bold text-navy">New manufacturer</p>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name — e.g. TELK"
                className={`${inputClass} py-2 text-sm`}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                  placeholder="Country"
                  className={`${inputClass} py-2 text-sm`}
                />
                <input
                  value={newWarranty}
                  onChange={(e) => setNewWarranty(e.target.value)}
                  inputMode="numeric"
                  placeholder="Warranty months"
                  className={`${inputClass} py-2 text-sm`}
                />
              </div>
              <input
                value={newContact}
                onChange={(e) => setNewContact(e.target.value)}
                placeholder="Contact person (optional)"
                className={`${inputClass} py-2 text-sm`}
              />
              <p className="text-[11px] text-ink-soft">
                Warranty months is copied onto every unit received from them, and never rewritten
                afterwards — so getting it right now matters more than it looks.
              </p>
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setAdding(false); setError(null); }}
                  className="flex-1 rounded-lg border border-line py-2 text-xs font-bold text-navy"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={createManufacturer}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-kplc py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  {busy ? "Adding…" : "Add and select"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
