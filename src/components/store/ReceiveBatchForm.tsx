"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ManufacturerPicker, type PickerManufacturer } from "@/components/manufacturer/ManufacturerPicker";

const RATINGS = [25, 50, 100, 200, 315, 500, 1000];

type Row = { key: number; serialNumber: string; ratingKva: string; yearOfManufacture: string; sampleTested: boolean };

/**
 * Booking in a lorry-load and naming the sample.
 *
 * Two things here are deliberate. The delivery note's claimed count is a
 * separate field from the rows actually entered, and the form SHOWS the
 * difference rather than reconciling it — "12 declared, 11 entered" is the most
 * useful thing a goods-in process ever produces, and hiding it would be the
 * whole point missed.
 *
 * And the tested checkboxes are on the same screen as the rows, not a later
 * step. A keeper who has to come back to mark the sample will mark it from
 * memory, which is the failure this feature exists to end.
 */
export function ReceiveBatchForm({
  manufacturers,
  storeName,
}: {
  manufacturers: PickerManufacturer[];
  storeName: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [makers, setMakers] = useState(manufacturers);
  const [manufacturerId, setManufacturerId] = useState("");
  const [declared, setDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { key: 1, serialNumber: "", ratingKva: "315", yearOfManufacture: String(new Date().getFullYear()), sampleTested: true },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tested = rows.filter((r) => r.sampleTested).length;
  const declaredNum = Number(declared) || 0;
  const mismatch = declaredNum > 0 && declaredNum !== rows.length;

  const nextKey = useMemo(() => Math.max(0, ...rows.map((r) => r.key)) + 1, [rows]);

  function addRow(count = 1) {
    setRows((prev) => {
      const start = Math.max(0, ...prev.map((r) => r.key)) + 1;
      const last = prev[prev.length - 1];
      return [
        ...prev,
        ...Array.from({ length: count }, (_, i) => ({
          key: start + i,
          serialNumber: "",
          ratingKva: last?.ratingKva ?? "315",
          yearOfManufacture: last?.yearOfManufacture ?? String(new Date().getFullYear()),
          sampleTested: false,
        })),
      ];
    });
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!manufacturerId) {
      setError("Choose the manufacturer.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manufacturerId,
          totalCount: declaredNum || rows.length,
          notes: notes || undefined,
          units: rows.map((r) => ({
            serialNumber: r.serialNumber || undefined,
            ratingKva: Number(r.ratingKva),
            yearOfManufacture: Number(r.yearOfManufacture),
            sampleTested: r.sampleTested,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not book the consignment in.");
        return;
      }
      toast(data.message, data.declaredMismatch ? "error" : "success");
      router.push("/store/dashboard");
      router.refresh();
    } catch {
      setError("No connection. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 pb-10">
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">1 · The consignment</h2>
        <p className="mt-1 text-xs text-ink-soft">Into {storeName}.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-bold text-ink-soft">Manufacturer</label>
            <div className="mt-1">
              <ManufacturerPicker
                manufacturers={makers}
                value={manufacturerId}
                onChange={setManufacturerId}
                onCreated={(m) => setMakers((prev) => [...prev, m])}
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft" htmlFor="declared">
              How many the delivery note says
            </label>
            <input
              id="declared"
              value={declared}
              onChange={(e) => setDeclared(e.target.value)}
              inputMode="numeric"
              placeholder="12"
              className={`${inputClass} mt-1 text-base`}
            />
          </div>
        </div>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Delivery note reference, anything unusual"
          className={`${inputClass} mt-3 text-base`}
        />
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-bold text-navy">2 · The transformers</h2>
          <p className="text-xs font-bold text-kplc">
            Testing {tested} of {rows.length} per KPLC sampling policy
          </p>
        </div>

        {mismatch && (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            The delivery note says {declaredNum}, you have entered {rows.length}. Both numbers are
            recorded — the approver will see the difference.
          </p>
        )}
        {tested === 0 && rows.length > 0 && (
          <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
            Nothing is marked for testing. The whole consignment would be released untested.
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink-soft">#{i + 1}</span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    className="text-xs font-bold text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <input
                  value={r.serialNumber}
                  onChange={(e) => update(r.key, { serialNumber: e.target.value })}
                  autoCapitalize="characters"
                  placeholder="Serial (blank if unreadable)"
                  className={`${inputClass} py-2 text-sm`}
                />
                <select
                  value={r.ratingKva}
                  onChange={(e) => update(r.key, { ratingKva: e.target.value })}
                  className={`${inputClass} py-2 text-sm`}
                >
                  {RATINGS.map((v) => <option key={v} value={v}>{v} kVA</option>)}
                </select>
                <input
                  value={r.yearOfManufacture}
                  onChange={(e) => update(r.key, { yearOfManufacture: e.target.value })}
                  inputMode="numeric"
                  placeholder="Year"
                  className={`${inputClass} py-2 text-sm`}
                />
              </div>
              <label className="mt-2 flex min-h-11 items-center gap-2 text-xs font-semibold text-navy">
                <input
                  type="checkbox"
                  checked={r.sampleTested}
                  onChange={(e) => update(r.key, { sampleTested: e.target.checked })}
                  className="h-5 w-5"
                />
                Test this one
              </label>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => addRow(1)} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-xs font-bold text-navy">
            + Add one
          </button>
          <button type="button" onClick={() => addRow(5)} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-xs font-bold text-navy">
            + Add five
          </button>
        </div>
      </section>

      {error && <FormError message={error} />}

      <button
        type="submit"
        disabled={busy || rows.length === 0}
        className="w-full rounded-xl bg-kplc py-3.5 text-sm font-bold text-white shadow-lg shadow-kplc/25 disabled:bg-ink-soft/40 disabled:shadow-none"
      >
        {busy ? "Booking in…" : `Book in ${rows.length} — ${tested} to be tested`}
      </button>
      <p className="text-center text-[11px] text-ink-soft">
        Nothing becomes stock yet. A second person releases the consignment, and the units nobody
        tested are flagged for the rest of their lives.
      </p>
    </form>
  );
}
