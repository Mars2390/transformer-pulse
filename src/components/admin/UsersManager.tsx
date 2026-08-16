"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { ROLE_LABELS, formatDate, formatRelative, type Tone } from "@/lib/format";
import type { Role } from "@/generated/prisma/enums";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  region: string | null;
  storeName: string | null;
  active: boolean;
  locked: boolean;
  lastLoginISO: string | null;
  eventCount: number;
};

type Store = { id: string; name: string; region: string };

const ROLE_TONE: Record<Role, Tone> = {
  ADMIN: "danger",
  MANAGER: "warning",
  STORE_MANAGER: "warning",
  STORE_KEEPER: "info",
  FIELD_ENGINEER: "success",
};

const ROLE_OPTIONS: Role[] = ["FIELD_ENGINEER", "STORE_KEEPER", "MANAGER", "ADMIN"];

export function UsersManager({
  users,
  stores,
  regions,
  currentUserId,
}: {
  users: AdminUser[];
  stores: Store[];
  regions: string[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetResult, setResetResult] = useState<{ name: string; pin: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    return !q || `${u.name} ${u.email} ${u.region ?? ""}`.toLowerCase().includes(q);
  });

  async function action(user: AdminUser, act: "disable" | "enable" | "unlock" | "resetPin") {
    if (act === "disable" && !window.confirm(`Disable ${user.name}? They will not be able to log in. Their records are preserved.`)) return;
    setBusyId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) return window.alert(data.error ?? "Action failed.");
    if (act === "resetPin" && data.newPin) setResetResult({ name: user.name, pin: data.newPin });
    router.refresh();
  }

  async function remove(user: AdminUser) {
    if (user.eventCount > 0) {
      return window.alert(`${user.name} has ${user.eventCount} recorded actions and cannot be deleted. Disable instead.`);
    }
    if (!window.confirm(`Permanently delete ${user.name}? This cannot be undone.`)) return;
    setBusyId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) return window.alert(data.error ?? "Delete failed.");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, region…"
          className={`${inputClass} max-w-xs`}
        />
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-xl bg-kplc px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-kplc/20 transition-colors hover:bg-kplc-light"
        >
          + Add user
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface text-[11px] font-bold tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">NAME</th>
              <th className="px-4 py-3">ROLE</th>
              <th className="px-4 py-3">REGION / STORE</th>
              <th className="px-4 py-3">STATUS</th>
              <th className="px-4 py-3">LAST LOGIN</th>
              <th className="px-4 py-3">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((u) => (
              <tr key={u.id} className={`hover:bg-surface ${!u.active ? "opacity-55" : ""}`}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-navy">{u.name}</p>
                  <p className="text-xs text-ink-soft">{u.email}</p>
                </td>
                <td className="px-4 py-3"><Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge></td>
                <td className="px-4 py-3 text-xs text-ink-soft">{u.region ?? u.storeName ?? "—"}</td>
                <td className="px-4 py-3">
                  {!u.active ? <Badge tone="neutral">Disabled</Badge> : u.locked ? <Badge tone="danger">Locked</Badge> : <Badge tone="success">Active</Badge>}
                </td>
                <td className="px-4 py-3 text-xs text-ink-soft">{u.lastLoginISO ? formatRelative(u.lastLoginISO) : "Never"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <ActionBtn onClick={() => setEditing(u)} disabled={busyId === u.id}>Edit</ActionBtn>
                    <ActionBtn onClick={() => action(u, "resetPin")} disabled={busyId === u.id}>Reset PIN</ActionBtn>
                    {u.locked && <ActionBtn onClick={() => action(u, "unlock")} disabled={busyId === u.id}>Unlock</ActionBtn>}
                    {u.active ? (
                      u.id !== currentUserId && <ActionBtn onClick={() => action(u, "disable")} disabled={busyId === u.id}>Disable</ActionBtn>
                    ) : (
                      <ActionBtn onClick={() => action(u, "enable")} disabled={busyId === u.id}>Enable</ActionBtn>
                    )}
                    {u.eventCount === 0 && u.id !== currentUserId && (
                      <ActionBtn tone="danger" onClick={() => remove(u)} disabled={busyId === u.id}>Delete</ActionBtn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <UserForm
          stores={stores}
          regions={regions}
          roleOptions={ROLE_OPTIONS}
          editing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); router.refresh(); }}
        />
      )}

      <Modal open={!!resetResult} onClose={() => setResetResult(null)} title="New PIN">
        {resetResult && (
          <div>
            <p className="text-sm text-navy">
              New PIN for <strong>{resetResult.name}</strong>:
            </p>
            <p className="mt-3 rounded-xl bg-surface-2 py-4 text-center font-mono text-3xl font-bold tracking-[0.3em] text-navy">
              {resetResult.pin}
            </p>
            <p className="mt-3 text-xs text-ink-soft">
              Copy this now — it will not be shown again. Give it to them in person, never over WhatsApp. They will be asked to change it at next sign-in.
            </p>
            <button
              type="button"
              onClick={() => setResetResult(null)}
              className="mt-4 w-full rounded-xl bg-kplc py-3 text-sm font-bold text-white"
            >
              Done
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, tone }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; tone?: "danger" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
        tone === "danger" ? "border-red-200 text-red-700 hover:bg-red-50" : "border-line text-navy hover:border-kplc hover:text-kplc"
      }`}
    >
      {children}
    </button>
  );
}

function UserForm({
  stores, regions, roleOptions, editing, onClose, onSaved,
}: {
  stores: Store[];
  regions: string[];
  roleOptions: Role[];
  editing: AdminUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<Role>(editing?.role ?? "FIELD_ENGINEER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    const payload = Object.fromEntries(new FormData(e.currentTarget).entries());

    const res = await fetch(editing ? `/api/admin/users/${editing.id}` : "/api/admin/users", {
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
    <Modal open onClose={onClose} title={editing ? `Edit ${editing.name}` : "Add user"}>
      <form onSubmit={submit} className="space-y-4">
        {error && <FormError message={error} />}
        {editing && role !== editing.role && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            This changes {editing.name}&apos;s access. They will no longer see their current dashboard.
          </p>
        )}

        <Field label="Full name" htmlFor="name" required error={fields.name}>
          <input id="name" name="name" required defaultValue={editing?.name} className={inputClass} />
        </Field>

        {!editing && (
          <Field label="Email" htmlFor="email" required error={fields.email}>
            <input id="email" name="email" type="email" required autoCapitalize="none" className={inputClass} placeholder="name@kplc.co.ke" />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" htmlFor="role" required>
            <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <Field label="Phone" htmlFor="phone" error={fields.phone}>
            <input id="phone" name="phone" inputMode="tel" defaultValue={editing?.phone ?? ""} className={inputClass} placeholder="0722123456" />
          </Field>
        </div>

        {role === "STORE_KEEPER" ? (
          <Field label="Store" htmlFor="storeId" required hint="A store keeper sees only their store's inventory.">
            <select id="storeId" name="storeId" required className={inputClass} defaultValue="">
              <option value="">— choose a store —</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        ) : role !== "ADMIN" ? (
          <Field label="Region" htmlFor="region" required hint="Scopes what they can see.">
            <select id="region" name="region" required className={inputClass} defaultValue={editing?.region ?? ""}>
              <option value="">— choose a region —</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        ) : null}

        {!editing && (
          <Field label="Starting PIN" htmlFor="pin" required error={fields.pin} hint="6 digits. Give it to them in person.">
            <input id="pin" name="pin" inputMode="numeric" maxLength={6} required className={inputClass} placeholder="6 digits" />
          </Field>
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line py-3 text-sm font-semibold text-navy">Cancel</button>
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Saving…" : editing ? "Save changes" : "Create account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
