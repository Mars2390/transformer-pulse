"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, FormSection, inputClass } from "@/components/ui/Field";
import { PhotoUpload } from "@/components/ui/PhotoUpload";

export function DispatchForm({
  transformerId,
  gNumber,
  serialNumber,
  ratingKva,
  regions,
  defaultRegion,
  engineers,
}: {
  transformerId: string;
  gNumber: string | null;
  serialNumber: string;
  ratingKva: number;
  regions: string[];
  defaultRegion: string;
  engineers: FieldEngineerOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [plate, setPlate] = useState("");
  const [region, setRegion] = useState(defaultRegion);
  const [engineerId, setEngineerId] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});

    const form = new FormData(event.currentTarget);
    const payload = { ...Object.fromEntries(form.entries()), photoUrls };

    const response = await fetch(`/api/transformers/${transformerId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Could not dispatch this transformer.");
      setFields(data.fields ?? {});
      setBusy(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    router.push("/store/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <FormError message={error} />}

      <div className="rounded-2xl border border-kplc/15 bg-kplc/5 px-5 py-4">
        <p className="text-xs font-bold tracking-[0.1em] text-kplc">DISPATCHING</p>
        <p className="mt-1 font-mono text-lg font-bold text-navy">
          {gNumber ?? serialNumber}
        </p>
        <p className="text-xs text-ink-soft">
          {ratingKva} kVA · once dispatched it appears on the field engineer&apos;s
          phone immediately.
        </p>
      </div>

      <FormSection title="Destination">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Site or area"
            htmlFor="destination"
            required
            error={fields.destination}
            className="sm:col-span-2"
          >
            <input
              id="destination"
              name="destination"
              required
              autoFocus
              placeholder="Kabete Primary School"
              className={inputClass}
            />
          </Field>

          <Field label="Region" htmlFor="region" required error={fields.region}>
            <select
              id="region"
              name="region"
              value={region}
              onChange={(e) => { setRegion(e.target.value); setEngineerId(""); }}
              className={inputClass}
            >
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>

          <Field label="County" htmlFor="county" error={fields.county}>
            <input id="county" name="county" placeholder="Nairobi" className={inputClass} />
          </Field>

          {/* --- Who is receiving it ------------------------------------------
              Required. A transformer on a lorry with nobody's name against it
              is how a unit sits in a yard for a fortnight while everyone
              assumes somebody else is collecting it. The list narrows to the
              destination region, and the server checks the same rule. */}
          <div className="sm:col-span-2">
            <Field
              label="Assign field engineer"
              htmlFor="assignedEngineerId"
              required
              error={fields.assignedEngineerId}
              hint={`Engineers working in ${region}. They see it on their phone as soon as it is dispatched.`}
            >
              <EngineerPicker
                engineers={engineers}
                region={region}
                value={engineerId}
                onChange={setEngineerId}
                name="assignedEngineerId"
              />
            </Field>
          </div>

          <Field
            label="Expected arrival"
            htmlFor="expectedArrival"
            error={fields.expectedArrival}
            className="sm:col-span-2"
          >
            <input
              id="expectedArrival"
              name="expectedArrival"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputClass}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Vehicle and driver"
        description="This is the part paper always loses. If it goes missing, this is who had it."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Vehicle plate"
            htmlFor="vehiclePlate"
            required
            error={fields.vehiclePlate}
            hint={`${plate.replace(/\s/g, "").length}/7 characters — e.g. KDA 123A`}
          >
            <input
              id="vehiclePlate"
              name="vehiclePlate"
              required
              value={plate}
              // Seven characters, and the space is presentation: typing is capped
              // at seven real characters while the space is re-inserted for
              // reading, so the box shows KDA 123A and sends KDA123A.
              onChange={(e) => {
                const raw = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 7);
                setPlate(raw.length > 3 ? `${raw.slice(0, 3)} ${raw.slice(3)}` : raw);
              }}
              placeholder="KDA 123A"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

          <Field label="Driver name" htmlFor="driverName" required error={fields.driverName}>
            <input id="driverName" name="driverName" required placeholder="Peter Mwangi" className={inputClass} />
          </Field>

          <Field label="Driver phone" htmlFor="driverPhone" error={fields.driverPhone} hint="10 digits, e.g. 0722123456">
            <input
              id="driverPhone"
              name="driverPhone"
              inputMode="numeric"
              maxLength={10}
              // Ten digits is the whole number, so the eleventh keystroke is
              // always a mistake. This box is uncontrolled, so the value is
              // corrected in place rather than through state — same rule the
              // server applies, applied at the keyboard instead of after a round
              // trip.
              onChange={(e) => {
                e.currentTarget.value = e.currentTarget.value
                  .replace(/\D/g, "")
                  .slice(0, 10);
              }}
              placeholder="0722123456"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Notes" htmlFor="notes" error={fields.notes}>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              placeholder="Escort assigned. Crane booked for Thursday morning."
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <PhotoUpload
            value={photoUrls}
            onChange={setPhotoUrls}
            max={3}
            label="Loaded vehicle (optional)"
            hint="A photo of the unit on the lorry, before it leaves the yard."
          />
        </div>
      </FormSection>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/store/dashboard")}
          className="rounded-xl border border-line bg-white px-6 py-3 text-sm font-semibold text-navy transition-colors hover:border-navy/30"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gold px-6 py-3 text-sm font-bold text-navy-dark shadow-lg shadow-gold/20 transition-colors hover:bg-gold-dark disabled:opacity-50"
        >
          {busy ? "Dispatching…" : "Dispatch to field"}
        </button>
      </div>
    </form>
  );
}

export type FieldEngineerOption = {
  id: string;
  name: string;
  email: string;
  region: string | null;
  activeTasks: number;
};

/**
 * Choosing the engineer who will receive a dispatch.
 *
 * Filtered to the destination region and searchable, because a region can hold
 * a dozen engineers and a <select> of every field engineer in the country is
 * how the wrong name gets picked on a phone. The active-task count is shown so
 * a store keeper can avoid piling a fifth delivery on somebody already holding
 * four — the system knows that, and the keeper usually does not.
 */
function EngineerPicker({
  engineers,
  region,
  value,
  onChange,
  name,
}: {
  engineers: FieldEngineerOption[];
  region: string;
  value: string;
  onChange: (id: string) => void;
  name: string;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const base = (r: string | null | undefined) => (r ?? "").split(/[\s,/-]+/)[0].toLowerCase();
  const matches = (e: FieldEngineerOption) => {
    const a = base(e.region);
    const b = base(region);
    return !a || !b || a === b || a.includes(b) || b.includes(a);
  };

  const inRegion = engineers.filter(matches);
  const elsewhere = engineers.filter((e) => !matches(e));

  const q = query.trim().toLowerCase();
  const search = (list: FieldEngineerOption[]) =>
    q ? list.filter((e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)) : list;

  const selected = engineers.find((e) => e.id === value);
  const selectedOutOfRegion = Boolean(selected && !matches(selected));

  const row = (e: FieldEngineerOption, outOfRegion: boolean) => (
    <li key={e.id}>
      <button
        type="button"
        onClick={() => onChange(e.id)}
        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface ${
          e.id === value ? "bg-kplc/5" : ""
        }`}
      >
        <span className="min-w-0">
          <span className={`block truncate text-sm ${e.id === value ? "font-bold text-navy" : "text-ink"}`}>
            {e.name}
          </span>
          <span className="block truncate text-xs text-ink-soft">
            {e.email} · {e.region ?? "no region"}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-xs font-semibold text-ink-soft">{e.activeTasks} active</span>
          {outOfRegion && (
            <span className="block text-[10px] font-bold text-amber-700">other region</span>
          )}
        </span>
      </button>
    </li>
  );

  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        className={`${inputClass} mb-2 py-2 text-sm`}
      />

      {inRegion.length === 0 && !showAll ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-900">
            No active field engineer is recorded for {region}.
          </p>
          <p className="mt-1 text-[11px] text-amber-800">
            {elsewhere.length > 0
              ? `There are ${elsewhere.length} elsewhere. The dispatch API refuses an out-of-region assignment, so choosing one here will be rejected — but you can see who exists, which is more use than an empty box.`
              : "There are no active field engineers at all. An admin has to create one before anything can be dispatched."}
          </p>
          {elsewhere.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-900"
            >
              Show all {engineers.length} field engineers
            </button>
          )}
        </div>
      ) : (
        <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-xl border border-line">
          {search(inRegion).map((e) => row(e, false))}

          {/* Everyone else, under a heading, only when asked for.
              The list used to be region-filtered with no way past it, so a
              region with nobody recorded made dispatch impossible and gave no
              clue why. Showing the rest is not a loosening: the API still
              refuses a cross-region assignment. It is the difference between
              "nothing here" and "here is who exists and why you cannot use
              them", and only the second tells somebody what to fix. */}
          {(showAll || q.length > 0) &&
            search(elsewhere).length > 0 && [
              <li key="__other" className="bg-surface px-3 py-1.5 text-[10px] font-bold tracking-wide text-ink-soft">
                OTHER REGIONS — the API will refuse these for {region}
              </li>,
              ...search(elsewhere).map((e) => row(e, true)),
            ]}
        </ul>
      )}

      {!showAll && inRegion.length > 0 && elsewhere.length > 0 && q.length === 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-[11px] font-bold text-ink-soft hover:text-kplc"
        >
          Show the other {elsewhere.length} outside {region}
        </button>
      )}

      {selected && (
        <p className={`mt-2 text-xs font-bold ${selectedOutOfRegion ? "text-amber-700" : "text-navy"}`}>
          {selectedOutOfRegion
            ? `${selected.name} works in ${selected.region ?? "no recorded region"}, not ${region}. This will be refused on submit — either change the region above or pick somebody local.`
            : `Assigned to ${selected.name} — ${selected.activeTasks} other active ${selected.activeTasks === 1 ? "task" : "tasks"}.`}
        </p>
      )}
    </div>
  );
}
