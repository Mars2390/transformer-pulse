"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, inputClass } from "@/components/ui/Field";

export type AdminStore = {
  id: string;
  name: string;
  code: string;
  region: string;
  county: string;
  transformerCount: number;
};

export function StoresManager({ stores }: { stores: AdminStore[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-xl bg-kplc px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
        >
          + Add store
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">NAME</th>
              <th className="px-4 py-3">CODE</th>
              <th className="px-4 py-3">REGION</th>
              <th className="px-4 py-3">COUNTY</th>
              <th className="px-4 py-3">UNITS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stores.map((s) => (
              <tr key={s.id} className="hover:bg-surface">
                <td className="px-4 py-3 font-semibold text-navy">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">{s.code}</td>
                <td className="px-4 py-3 text-ink-soft">{s.region}</td>
                <td className="px-4 py-3 text-ink-soft">{s.county}</td>
                <td className="px-4 py-3 font-semibold text-navy">{s.transformerCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <StoreForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); router.refresh(); }} />
      )}
    </div>
  );
}

function StoreForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/admin/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not save."); setFields(data.fields ?? {}); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title="Add store">
      <form onSubmit={submit} className="space-y-4">
        {error && <FormError message={error} />}
        <Field label="Store name" htmlFor="name" required error={fields.name}>
          <input id="name" name="name" required className={inputClass} placeholder="Ruaraka Central Store" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store code" htmlFor="code" required error={fields.code}>
            <input id="code" name="code" required className={`${inputClass} uppercase`} placeholder="NRB-RRK" />
          </Field>
          <Field label="Region" htmlFor="region" required error={fields.region}>
            <input id="region" name="region" required className={inputClass} placeholder="Nairobi North" />
          </Field>
        </div>
        <Field label="County" htmlFor="county" required error={fields.county}>
          <input id="county" name="county" required className={inputClass} placeholder="Nairobi" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Latitude" htmlFor="lat" hint="Optional">
            <input id="lat" name="lat" type="number" step="0.0001" className={inputClass} placeholder="-1.2333" />
          </Field>
          <Field label="Longitude" htmlFor="lng" hint="Optional">
            <input id="lng" name="lng" type="number" step="0.0001" className={inputClass} placeholder="36.8667" />
          </Field>
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold text-navy">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Add store"}</button>
        </div>
      </form>
    </Modal>
  );
}
