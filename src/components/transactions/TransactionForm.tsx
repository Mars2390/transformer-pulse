"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui";
import { formatRating, STATUS_META } from "@/lib/format";
import {
  MOVEMENTS,
  checkEligibility,
  requiresSiteEngineer,
  type Movement,
  type MovementKey,
} from "@/lib/transactions";
import type { Role, TransformerStatus } from "@/generated/prisma/enums";

export type MovableUnit = {
  id: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  status: TransformerStatus;
  manufacturerName: string;
  /** Where it physically is, in words — a store name or a site description. */
  whereNow: string;
  heldByStoreId: string | null;
  heldByStoreName: string | null;
};

export type Destination = { id: string; name: string; kind: string; region: string };

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "ALL", label: "All statuses" },
  { key: "PENDING_APPROVAL", label: "Pending approval" },
  { key: "IN_STORE", label: "In store" },
  { key: "IN_FIELD", label: "In field" },
  { key: "IN_TRANSIT", label: "In transit" },
  { key: "AT_WORKSHOP", label: "At workshop" },
  { key: "FAULTY", label: "Faulty" },
  { key: "REPAIRED", label: "Repaired" },
];

/**
 * Raising a movement.
 *
 * The rule this screen now obeys: NEVER hide a transformer somebody knows is
 * there. The previous version listed only units eligible for the selected
 * movement, so a store keeper whose stock was all awaiting approval saw an
 * empty list and reasonably concluded the system had lost their fleet.
 *
 * Every transformer in scope is listed. Ineligible ones are greyed with the
 * reason on the row — wrong status, or held by another store. The reason comes
 * from the same checkEligibility() the API uses, so what the screen says is
 * what the server would have replied.
 */
export type SiteEngineer = {
  id: string;
  name: string;
  email: string;
  region: string | null;
  activeTasks: number;
};

export function TransactionForm({
  units,
  destinations,
  allowed,
  heading,
  actor,
  engineers = [],
}: {
  units: MovableUnit[];
  destinations: Destination[];
  allowed: MovementKey[];
  heading: string;
  actor: { role: Role; storeId: string | null; id?: string };
  /** Every active field engineer, for movements that start at a site. */
  engineers?: SiteEngineer[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [movementKey, setMovementKey] = useState<MovementKey>(allowed[0]);
  const movement: Movement = MOVEMENTS[movementKey];

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [onlyEligible, setOnlyEligible] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toStoreId, setToStoreId] = useState("");
  const [toName, setToName] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [presentEngineerId, setPresentEngineerId] = useState("");
  const [engineerQuery, setEngineerQuery] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** Every unit, with its verdict for the currently selected movement. */
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return units
      .map((u) => ({ unit: u, verdict: checkEligibility(movement, u, actor) }))
      .filter(({ unit }) => {
        if (statusFilter !== "ALL" && unit.status !== statusFilter) return false;
        if (!q) return true;
        return [
          unit.gNumber,
          unit.serialNumber,
          unit.manufacturerName,
          unit.whereNow,
          unit.heldByStoreName,
          String(unit.ratingKva),
          `${unit.ratingKva} kva`,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .filter(({ verdict }) => (onlyEligible ? verdict.ok : true));
  }, [units, movement, actor, query, statusFilter, onlyEligible]);

  const eligibleCount = rows.filter((r) => r.verdict.ok).length;
  const selectedUnits = units.filter((u) => selected.has(u.id));

  const destinationsForMovement = useMemo(
    () => destinations.filter((d) => d.kind === movement.to),
    [destinations, movement],
  );

  const needsStore = movement.to === "STORE" || movement.to === "WORKSHOP";
  const canSubmit =
    selected.size > 0 &&
    (needsStore ? toStoreId !== "" : toName.trim() !== "") &&
    (!movement.requiresVehicle ||
      (vehiclePlate.trim() !== "" && driverName.trim() !== "" && driverPhone.trim() !== "")) &&
    (!requiresSiteEngineer(movement) || presentEngineerId !== "") &&
    !busy;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllShown() {
    const ids = rows.filter((r) => r.verdict.ok).map((r) => r.unit.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected(allOn ? new Set() : new Set([...selected, ...ids]));
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
          presentEngineerId: requiresSiteEngineer(movement) ? presentEngineerId : undefined,
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
      {/* --- 1. Movement --------------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">1 · What kind of movement</h2>
        <select
          value={movementKey}
          onChange={(e) => {
            setMovementKey(e.target.value as MovementKey);
            // Clearing this on a movement change is not tidiness. Leaving a
            // stale engineer selected on a store-to-store transfer would post a
            // name the API refuses, and the person would see an error about a
            // field that is no longer on screen.
            setPresentEngineerId("");
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
          Starts from{" "}
          <strong className="text-navy">
            {movement.allowedFrom.map((s) => STATUS_META[s].label.toLowerCase()).join(", ")}
          </strong>
          . Approved by a {movement.approvers.join(" or ").toLowerCase().replace(/_/g, " ")} — never you.
        </p>
      </section>

      {/* --- 2. Choose units ----------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-navy">2 · Which transformers</h2>
          <p className="text-xs font-bold text-kplc">Selected: {selected.size}</p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 G-Number, serial, maker, rating, place…"
            className={`${inputClass} py-2 text-sm sm:col-span-2`}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputClass} py-2 text-sm`}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={onlyEligible}
              onChange={(e) => setOnlyEligible(e.target.checked)}
              className="h-4 w-4"
            />
            Only show ones I can move now
          </label>
          <button
            type="button"
            onClick={selectAllShown}
            disabled={eligibleCount === 0}
            className="text-xs font-bold text-kplc hover:underline disabled:text-ink-soft disabled:no-underline"
          >
            Select all {eligibleCount} eligible
          </button>
          <span className="text-xs text-ink-soft">
            {rows.length} shown of {units.length} · {eligibleCount} movable now
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            {units.length === 0
              ? "There are no transformers in your scope at all. If you expect some, check they have been approved into stock and assigned to a store."
              : `Nothing matches that search or filter. Clear them to see all ${units.length}.`}
          </p>
        ) : (
          <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {rows.map(({ unit, verdict }) => (
              <li key={unit.id} className={verdict.ok ? "" : "bg-surface/70"}>
                <label
                  className={`flex items-start gap-3 px-3 py-2.5 ${
                    verdict.ok ? "cursor-pointer hover:bg-surface" : "cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(unit.id)}
                    onChange={() => toggle(unit.id)}
                    disabled={!verdict.ok}
                    className="mt-1 h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-navy">
                        {unit.gNumber ?? unit.serialNumber}
                      </span>
                      <Badge tone={STATUS_META[unit.status].tone}>{STATUS_META[unit.status].label}</Badge>
                    </span>
                    <span className="block truncate text-xs text-ink-soft">
                      {formatRating(unit.ratingKva)} · {unit.manufacturerName} · {unit.whereNow}
                    </span>
                    {!verdict.ok && (
                      <span className="mt-0.5 block text-xs font-semibold text-amber-700">
                        {verdict.reason}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {selectedUnits.length > 0 && (
          <div className="mt-3 rounded-xl border border-kplc/30 bg-kplc/5 px-3 py-2">
            <p className="text-xs font-bold text-navy">
              Selected: {selectedUnits.length} {selectedUnits.length === 1 ? "transformer" : "transformers"}
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              {selectedUnits.map((u) => u.gNumber ?? u.serialNumber).join(", ")}
            </p>
          </div>
        )}
      </section>

      {/* --- 3. Destination ------------------------------------------------ */}
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
                No active {movement.to.toLowerCase()} exists yet. An admin adds one under Stores — a
                workshop is a store whose kind is set to WORKSHOP.
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

      {/* --- Who is at the pole -------------------------------------------- */}
      {requiresSiteEngineer(movement) && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
          <h2 className="text-sm font-bold text-navy">Which field engineer is at the site?</h2>
          <p className="mt-1 text-xs text-ink-soft">
            A transformer cannot leave a pole without somebody standing at it. You may raise this
            movement from anywhere, but the engineer you name has to confirm on their own phone
            before the lorry is allowed to depart — and nobody can confirm on their behalf.
          </p>

          {engineers.length === 0 ? (
            <p className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800">
              No active field engineer exists. An admin has to create one before anything can be
              moved off a site.
            </p>
          ) : (
            <>
              <input
                value={engineerQuery}
                onChange={(e) => setEngineerQuery(e.target.value)}
                placeholder="Search by name, email or region"
                className={`${inputClass} mt-3 py-2 text-sm`}
              />
              <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-white">
                {engineers
                  .filter((e) => {
                    const q = engineerQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      e.name.toLowerCase().includes(q) ||
                      e.email.toLowerCase().includes(q) ||
                      (e.region ?? "").toLowerCase().includes(q)
                    );
                  })
                  .map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setPresentEngineerId(e.id)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface ${
                          e.id === presentEngineerId ? "bg-kplc/5" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-sm ${
                              e.id === presentEngineerId ? "font-bold text-navy" : "text-ink"
                            }`}
                          >
                            {e.name}
                            {actor.id === e.id ? " (you)" : ""}
                          </span>
                          <span className="block truncate text-xs text-ink-soft">
                            {e.email} · {e.region ?? "no region"}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-ink-soft">
                          {e.activeTasks} active
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
              {fieldErrors.presentEngineerId && (
                <p className="mt-1 text-xs font-semibold text-red-700">
                  {fieldErrors.presentEngineerId}
                </p>
              )}
              {presentEngineerId && (
                <p className="mt-2 text-xs font-bold text-navy">
                  {actor.id === presentEngineerId
                    ? "You are naming yourself, so presence is confirmed as you raise it."
                    : `${engineers.find((e) => e.id === presentEngineerId)?.name} will see this on their dashboard and must confirm before departure.`}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* --- 4. Vehicle ---------------------------------------------------- */}
      {movement.requiresVehicle && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <h2 className="text-sm font-bold text-navy">4 · Vehicle and driver</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Required for anything that physically moves — this is what makes a unit traceable between
            two places.
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
              <label className="block text-xs font-bold text-ink-soft" htmlFor="driverPhone">
                Driver phone <span className="text-red-600">*</span>
              </label>
              <input
                id="driverPhone"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                inputMode="tel"
                placeholder="0722000000"
                className={`${inputClass} mt-1 text-base`}
              />
              {fieldErrors.driverPhone && (
                <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.driverPhone}</p>
              )}
              <p className="mt-1 text-[11px] text-ink-soft">
                When a lorry is three hours late, a name is not something anybody can ring.
              </p>
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
