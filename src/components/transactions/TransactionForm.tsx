"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatRating } from "@/lib/format";
import { MOVEMENTS, type Movement, type MovementKey } from "@/lib/transactions";

export type MovableUnit = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  status: string;
  whereNow: string;
};

export type Destination = { id: string; name: string; kind: string; region: string };

/**
 * Raising a movement, used by both the store transfer screen and the field
 * recovery screen. The only difference between them is which movements the
 * signed-in role may raise, and that is decided by the catalog rather than by
 * two nearly-identical components.
 *
 * The transformer list is filtered as the movement changes: a unit that is
 * IN_STORE cannot be recovered from a site, and offering it only to refuse it
 * later wastes a trip. The API re-checks anyway.
 */
export function TransactionForm({
  units,
  destinations,
  allowed,
  heading,
}: {
  units: MovableUnit[];
  destinations: Destination[];
  allowed: MovementKey[];
  heading: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [movementKey, setMovementKey] = useState<MovementKey>(allowed[0]);
  const movement: Movement = MOVEMENTS[movementKey];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toStoreId, setToStoreId] = useState("");
  const [toName, setToName] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const eligible = useMemo(
    () => units.filter((u) => movement.allowedFrom.includes(u.status as never)),
    [units, movement],
  );

  const destinationsForMovement = useMemo(
    () => destinations.filter((d) => d.kind === movement.to),
    [destinations, movement],
  );

  const needsStore = movement.to === "STORE" || movement.to === "WORKSHOP";
  const canSubmit =
    selected.size > 0 &&
    (needsStore ? toStoreId !== "" : toName.trim() !== "") &&
    (!movement.requiresVehicle || (vehiclePlate.trim() !== "" && driverName.trim() !== "")) &&
    !busy;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transformerIds: [...selected],
          movement: movementKey,
          toStoreId: needsStore ? toStoreId : undefined,
          toName: needsStore ? undefined : toName,
          vehiclePlate: vehiclePlate || undefined,
          driverName: driverName || undefined,
          driverPhone: driverPhone || undefined,
          reason: reason || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Could not raise the movement.");
        if (data?.fields) setFieldErrors(data.fields);
        return;
      }

      toast(data.message, data.skipped?.length ? "error" : "success");
      setSelected(new Set());
      router.refresh();
    } catch {
      setError("No connection. Nothing was raised.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">1 · What kind of movement</h2>
        <select
          value={movementKey}
          onChange={(e) => {
            setMovementKey(e.target.value as MovementKey);
            setSelected(new Set());
            setToStoreId("");
            setToName("");
          }}
          className={`${inputClass} mt-3 text-base`}
        >
          {allowed.map((k) => (
            <option key={k} value={k}>{MOVEMENTS[k].label}</option>
          ))}
        </select>
        <p className="mt-2 text-xs text-ink-soft">{movement.description}</p>
        <p className="mt-1 text-xs text-ink-soft">
          Goes to a <strong className="text-navy">{movement.approvers.join(" or ").toLowerCase().replace(/_/g, " ")}</strong> for
          approval. You cannot approve your own.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">
          2 · Which transformers <span className="font-normal text-ink-soft">({selected.size} selected)</span>
        </h2>
        {eligible.length === 0 ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Nothing you hold is in a state where a {movement.label} movement is possible.
          </p>
        ) : (
          <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {eligible.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-navy">
                      {u.gNumber ?? u.serialNumber}
                    </span>
                    <span className="block truncate text-xs text-ink-soft">
                      {formatRating(u.ratingKva)} · {u.whereNow}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">3 · Where it is going</h2>
        {needsStore ? (
          <>
            <select
              value={toStoreId}
              onChange={(e) => setToStoreId(e.target.value)}
              className={`${inputClass} mt-3 text-base`}
            >
              <option value="">Choose a {movement.to.toLowerCase()}…</option>
              {destinationsForMovement.map((d) => (
                <option key={d.id} value={d.id}>{d.name} · {d.region}</option>
              ))}
            </select>
            {destinationsForMovement.length === 0 && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                No active {movement.to.toLowerCase()} is set up yet. An admin has to add one first.
              </p>
            )}
          </>
        ) : (
          <input
            value={toName}
            onChange={(e) => setToName(e.target.value)}
            placeholder={movement.to === "SCRAP" ? "Where it is being written off" : "Site or manufacturer name"}
            className={`${inputClass} mt-3 text-base`}
          />
        )}
        {fieldErrors.toStoreId && <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.toStoreId}</p>}
        {fieldErrors.toName && <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.toName}</p>}
      </section>

      {movement.requiresVehicle && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <h2 className="text-sm font-bold text-navy">4 · Vehicle and driver</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Required for anything that physically moves. This is what makes a unit traceable between two places.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-bold text-ink-soft" htmlFor="vehiclePlate">
                Number plate <span className="text-red-600">*</span>
              </label>
              <input
                id="vehiclePlate"
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                autoCapitalize="characters"
                placeholder="KDA 123A"
                className={`${inputClass} mt-1 text-base`}
              />
              {fieldErrors.vehiclePlate && (
                <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.vehiclePlate}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-soft" htmlFor="driverName">
                Driver <span className="text-red-600">*</span>
              </label>
              <input
                id="driverName"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className={`${inputClass} mt-1 text-base`}
              />
              {fieldErrors.driverName && (
                <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.driverName}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-soft" htmlFor="driverPhone">Driver phone</label>
              <input
                id="driverPhone"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                inputMode="tel"
                placeholder="0722000000"
                className={`${inputClass} mt-1 text-base`}
              />
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">Why, and anything else</h2>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason — the approver reads this first"
          className={`${inputClass} mt-3 text-base`}
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notes"
          className={`${inputClass} mt-2 text-base`}
        />
      </section>

      {error && <FormError message={error} />}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-xl bg-kplc py-3.5 text-sm font-bold text-white shadow-lg shadow-kplc/25 transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-ink-soft/40 disabled:shadow-none"
      >
        {busy ? "Raising…" : `Raise ${heading.toLowerCase()} for ${selected.size || "0"}`}
      </button>
      <p className="text-center text-[11px] text-ink-soft">
        Nothing moves yet. This is a request — the chain is written when the unit actually arrives.
      </p>
    </form>
  );
}
