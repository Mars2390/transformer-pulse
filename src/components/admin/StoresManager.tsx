"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { tapTarget } from "@/components/ui";

export type AdminStoreUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
};

export type AdminStore = {
  id: string;
  name: string;
  code: string;
  region: string;
  county: string;
  kind: string;
  active: boolean;
  transformerCount: number;
  movementCount: number;
  users: AdminStoreUser[];
};

export function StoresManager({ stores }: { stores: AdminStore[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminStore | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function patch(store: AdminStore, body: Record<string, unknown>) {
    setBusyId(store.id);
    setRowError(null);
    const res = await fetch(`/api/admin/stores/${store.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setBusyId(null);
    if (!res.ok) { setRowError(data?.error ?? "Could not save."); return; }
    router.refresh();
  }

  async function remove(store: AdminStore) {
    setBusyId(store.id);
    setRowError(null);
    const res = await fetch(`/api/admin/stores/${store.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    setBusyId(null);
    if (!res.ok) { setRowError(data?.error ?? "Could not delete."); return; }
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex min-h-11 items-center rounded-xl bg-kplc px-4 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
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
              <th className="px-4 py-3">KIND</th>
              <th className="px-4 py-3">UNITS</th>
              <th className="px-4 py-3">STAFF</th>
              <th className="px-4 py-3">STATUS</th>
              <th className="px-4 py-3 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stores.map((s) => {
              const deletable = s.transformerCount === 0 && s.users.length === 0 && s.movementCount === 0;
              return (
                <Fragment key={s.id}>
                  <tr className={s.active ? "hover:bg-surface" : "bg-surface/60 hover:bg-surface"}>
                    <td className="px-4 py-3 font-semibold text-navy">{s.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">{s.code}</td>
                    <td className="px-4 py-3 text-ink-soft">{s.region}</td>
                    <td className="px-4 py-3 text-ink-soft">{s.county}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.kind === "WORKSHOP" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>
                        {s.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-navy">{s.transformerCount}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                        className={`${tapTarget} px-2 text-xs font-bold text-kplc hover:underline`}
                      >
                        {s.users.length} {expanded === s.id ? "▲" : "▼"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold ${s.active ? "text-emerald-700" : "text-ink-soft"}`}>
                        {s.active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(s)}
                          disabled={busyId === s.id}
                          className={`${tapTarget} px-2 text-xs font-bold text-kplc hover:underline disabled:opacity-40`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => patch(s, { active: !s.active })}
                          disabled={busyId === s.id}
                          className={`${tapTarget} px-2 text-xs font-bold text-amber-700 hover:underline disabled:opacity-40`}
                        >
                          {s.active ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(s)}
                          disabled={busyId === s.id || !deletable}
                          title={deletable ? "Nothing is linked to this store" : "Has transformers, staff or movement history — disable it instead"}
                          className={`${tapTarget} px-2 text-xs font-bold text-red-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-soft disabled:no-underline`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === s.id && (
                    <tr className="bg-surface/70">
                      <td colSpan={9} className="px-4 py-3">
                        {s.users.length === 0 ? (
                          <p className="text-xs text-ink-soft">Nobody is assigned to this store.</p>
                        ) : (
                          <ul className="space-y-1">
                            {s.users.map((u) => (
                              <li key={u.id} className="flex flex-wrap items-center gap-3 text-xs">
                                <span className="font-bold text-navy">{u.name}</span>
                                <span className="text-ink-soft">{u.email}</span>
                                <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-ink-soft">
                                  {u.role.replace(/_/g, " ").toLowerCase()}
                                </span>
                                {!u.active && <span className="font-bold text-red-700">disabled</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {rowError && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {rowError}
        </p>
      )}

      {editing && (
        <EditStoreForm
          store={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="County" htmlFor="county" required error={fields.county}>
            <input id="county" name="county" required className={inputClass} placeholder="Nairobi" />
          </Field>
          <Field label="Kind" htmlFor="kind" hint="A workshop behaves like a store">
            <select id="kind" name="kind" defaultValue="STORE" className={inputClass}>
              <option value="STORE">Store</option>
              <option value="WORKSHOP">Workshop</option>
            </select>
          </Field>
        </div>
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

/**
 * Editing a store. The CODE is deliberately absent: it is the human key printed
 * on paperwork and referenced by imports, so renaming a store is a label change
 * and changing its code is a different store wearing the same clothes.
 */
function EditStoreForm({
  store,
  onClose,
  onSaved,
}: {
  store: AdminStore;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/admin/stores/${store.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        region: String(form.get("region") ?? ""),
        county: String(form.get("county") ?? ""),
        kind: String(form.get("kind") ?? "STORE"),
      }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { setError(data?.error ?? "Could not save."); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${store.name}`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <FormError message={error} />}
        <p className="text-xs text-ink-soft">
          Code <span className="font-mono font-bold text-navy">{store.code}</span> cannot be changed —
          it is referenced by imports and paperwork.
        </p>
        <Field label="Store name" htmlFor="edit-name" required>
          <input id="edit-name" name="name" required defaultValue={store.name} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Region" htmlFor="edit-region" required>
            <input id="edit-region" name="region" required defaultValue={store.region} className={inputClass} />
          </Field>
          <Field label="County" htmlFor="edit-county" required>
            <input id="edit-county" name="county" required defaultValue={store.county} className={inputClass} />
          </Field>
        </div>
        <Field
          label="Kind"
          htmlFor="edit-kind"
          hint={store.transformerCount > 0 ? "Cannot change while it holds stock" : "A workshop receives, holds and dispatches like a store"}
        >
          <select id="edit-kind" name="kind" defaultValue={store.kind} disabled={store.transformerCount > 0} className={inputClass}>
            <option value="STORE">Store</option>
            <option value="WORKSHOP">Workshop</option>
          </select>
        </Field>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold text-navy">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
