"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Store = { id: string; name: string; region: string };

const ROLES = [
  { value: "FIELD_ENGINEER", label: "Field Engineer" },
  { value: "STORE_KEEPER", label: "Store Keeper" },
  { value: "MANAGER", label: "Regional Manager" },
  { value: "ADMIN", label: "Administrator" },
] as const;

const inputClass =
  "mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-navy outline-none transition-colors focus:border-kplc focus:ring-4 focus:ring-kplc/10";

export function CreateUserForm({
  stores,
  regions,
}: {
  stores: Store[];
  regions: string[];
}) {
  const router = useRouter();
  const [role, setRole] = useState<string>("FIELD_ENGINEER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    setDone(null);

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not create the account.");
      setFields(data.fields ?? {});
      setBusy(false);
      return;
    }

    setDone(`${data.user.name} can now sign in as ${data.user.email}.`);
    (event.target as HTMLFormElement).reset();
    setRole("FIELD_ENGINEER");
    setBusy(false);
    router.refresh(); // pull the new user into the list beside this form
  }

  const Err = ({ name }: { name: string }) =>
    fields[name] ? (
      <p className="mt-1 text-xs font-medium text-red-600">{fields[name]}</p>
    ) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="text-xs font-bold text-navy">Full name</label>
        <input id="name" name="name" required className={inputClass} placeholder="Grace Wanjiru" />
        <Err name="name" />
      </div>

      <div>
        <label htmlFor="email" className="text-xs font-bold text-navy">Email</label>
        <input id="email" name="email" type="email" required autoCapitalize="none" className={inputClass} placeholder="name@kplc.co.ke" />
        <Err name="email" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className="text-xs font-bold text-navy">Phone</label>
          <input id="phone" name="phone" inputMode="tel" className={inputClass} placeholder="0722123456" />
          <Err name="phone" />
        </div>
        <div>
          <label htmlFor="staffNumber" className="text-xs font-bold text-navy">Staff number</label>
          <input id="staffNumber" name="staffNumber" className={inputClass} placeholder="KP-FLD-401" />
          <Err name="staffNumber" />
        </div>
      </div>

      <div>
        <label htmlFor="role" className="text-xs font-bold text-navy">Role</label>
        <select
          id="role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputClass}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="region" className="text-xs font-bold text-navy">Region</label>
        <select id="region" name="region" className={inputClass} defaultValue="">
          <option value="">— none —</option>
          {regions.map((region) => (
            <option key={region} value={region}>{region}</option>
          ))}
        </select>
      </div>

      {/* Only a store keeper belongs to a store, so only show it then. */}
      {role === "STORE_KEEPER" && (
        <div>
          <label htmlFor="storeId" className="text-xs font-bold text-navy">Store</label>
          <select id="storeId" name="storeId" required className={inputClass} defaultValue="">
            <option value="">— choose a store —</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-soft">
            Without a store, their inventory screen would be empty.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="pin" className="text-xs font-bold text-navy">Starting PIN</label>
        <input
          id="pin"
          name="pin"
          inputMode="numeric"
          maxLength={6}
          required
          className={inputClass}
          placeholder="6 digits"
        />
        <Err name="pin" />
        <p className="mt-1 text-xs text-ink-soft">
          Give this to them in person, never over WhatsApp.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-800">
          {done}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-xl bg-kplc px-5 py-3 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
