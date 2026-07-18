"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, inputClass } from "@/components/ui/Field";

export type AdminManufacturer = {
  id: string;
  name: string;
  country: string | null;
  warrantyMonths: number;
  contactEmail: string | null;
  contactPhone: string | null;
  contactName: string | null;
  transformerCount: number;
  claimCount: number;
};

export function ManufacturersManager({ manufacturers }: { manufacturers: AdminManufacturer[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminManufacturer | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-xl bg-kplc px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
        >
          + Add manufacturer
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">NAME</th>
              <th className="px-4 py-3">COUNTRY</th>
              <th className="px-4 py-3">WARRANTY</th>
              <th className="px-4 py-3">CONTACT</th>
              <th className="px-4 py-3">UNITS</th>
              <th className="px-4 py-3">CLAIMS</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {manufacturers.map((m) => (
              <tr key={m.id} className="hover:bg-surface">
                <td className="px-4 py-3 font-semibold text-navy">{m.name}</td>
                <td className="px-4 py-3 text-ink-soft">{m.country ?? "—"}</td>
                <td className="px-4 py-3 text-ink-soft">{m.warrantyMonths} months</td>
                <td className="px-4 py-3 text-xs text-ink-soft">{m.contactEmail ?? "—"}</td>
                <td className="px-4 py-3 font-semibold text-navy">{m.transformerCount}</td>
                <td className="px-4 py-3">{m.claimCount > 0 ? <Badge tone="warning">{m.claimCount}</Badge> : <span className="text-ink-soft">—</span>}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => setEditing(m)} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-navy hover:border-kplc hover:text-kplc">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <ManufacturerForm
          editing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ManufacturerForm({ editing, onClose, onSaved }: { editing: AdminManufacturer | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch(editing ? `/api/admin/manufacturers/${editing.id}` : "/api/admin/manufacturers", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data.error ?? "Could not save."); setFields(data.fields ?? {}); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${editing.name}` : "Add manufacturer"}>
      <form onSubmit={submit} className="space-y-4">
        {error && <FormError message={error} />}
        {editing && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            A warranty change affects only NEW transformers. Units already received keep their original terms.
          </p>
        )}
        <Field label="Name" htmlFor="name" required error={fields.name}>
          <input id="name" name="name" required defaultValue={editing?.name} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" htmlFor="country">
            <input id="country" name="country" defaultValue={editing?.country ?? ""} className={inputClass} />
          </Field>
          <Field label="Default warranty (months)" htmlFor="warrantyMonths" required error={fields.warrantyMonths}>
            <input id="warrantyMonths" name="warrantyMonths" type="number" required defaultValue={editing?.warrantyMonths ?? 24} className={inputClass} />
          </Field>
        </div>
        <Field label="Contact email" htmlFor="contactEmail">
          <input id="contactEmail" name="contactEmail" defaultValue={editing?.contactEmail ?? ""} className={inputClass} />
        </Field>
        <Field label="Contact phone" htmlFor="contactPhone">
          <input id="contactPhone" name="contactPhone" defaultValue={editing?.contactPhone ?? ""} className={inputClass} />
        </Field>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold text-navy">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
