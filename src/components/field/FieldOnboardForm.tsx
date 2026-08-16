"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGeolocation } from "@/lib/useGeolocation";
import { GpsCapture } from "@/components/field/GpsCapture";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

const RATINGS = [50, 100, 200, 315, 500, 1000];

/**
 * Onboarding an existing transformer, from a phone, standing under it.
 *
 * The ordering is deliberate and is not the same as the desk form's. A field
 * engineer has limited time, one hand, and a unit in front of them, so the
 * fields that only they can supply come first — GPS, substation, photographs —
 * and the nameplate details that anyone could add later come last. If they walk
 * away after filling three fields, the three that matter are the ones captured.
 *
 * Nothing here blocks on a value the engineer may not be able to see. Only the
 * GPS fix, the substation number and a location description are required; the
 * G-Number allocates itself, and a serial that cannot be read stays blank
 * rather than becoming a guess.
 */
export function FieldOnboardForm({
  manufacturers,
  engineerName,
}: {
  manufacturers: { id: string; name: string }[];
  engineerName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, capture } = useGeolocation();

  const [substationCode, setSubstationCode] = useState("");
  const [substationName, setSubstationName] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [gNumber, setGNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [manufacturerId, setManufacturerId] = useState("");
  const [ratingKva, setRatingKva] = useState("200");
  const [yearOfManufacture, setYearOfManufacture] = useState("");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // "Unknown" is a legitimate and common answer on a corroded plate, so it is
  // the default rather than something the engineer has to go hunting for.
  const unknownMaker = useMemo(
    () => manufacturers.find((m) => /unknown/i.test(m.name))?.id ?? manufacturers[0]?.id ?? "",
    [manufacturers],
  );
  const chosenMaker = manufacturerId || unknownMaker;

  const gpsReady = state.status === "ready";
  const canSubmit = gpsReady && substationCode.trim() !== "" && locationDescription.trim().length >= 3 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (state.status !== "ready") {
      setError("Wait for a GPS fix. That position is the whole point of doing this here.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/transformers/field-onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: state.lat,
          lng: state.lng,
          accuracyM: Math.round(state.accuracyM),
          substationCode,
          substationName: substationName || undefined,
          locationDescription,
          gNumber: gNumber || undefined,
          serialNumber: serialNumber || undefined,
          manufacturerId: chosenMaker,
          ratingKva: Number(ratingKva),
          yearOfManufacture: yearOfManufacture ? Number(yearOfManufacture) : undefined,
          photoUrls,
          notes: notes || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error ?? "Could not save. Check your signal and try again.");
        if (data?.fields) setFieldErrors(data.fields);
        return;
      }

      toast(data.message ?? "Onboarded.");
      router.push(`/transformers/${data.transformer.id}`);
      router.refresh();
    } catch {
      setError("No connection. Nothing was saved — try again when you have signal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 pb-28">
      {/* --- 1. Position: the one thing only you can capture ---------------- */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">1 · Where you are standing</h2>
        <p className="mt-1 text-xs text-ink-soft">
          This fix becomes the transformer&apos;s position, marked as surveyed because you are here.
        </p>
        <div className="mt-3">
          <GpsCapture state={state} onRetry={capture} required />
        </div>
      </section>

      {/* --- 2. Substation: the link into the rest of the network ----------- */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">2 · Substation</h2>
        <p className="mt-1 text-xs text-ink-soft">
          The number on the substation you are working from. If it is already in the system this
          transformer joins the others there; if not, it is recorded for the first time.
        </p>
        <label className="mt-3 block text-xs font-bold text-ink-soft" htmlFor="substationCode">
          Substation number <span className="text-red-600">*</span>
        </label>
        <input
          id="substationCode"
          value={substationCode}
          onChange={(e) => setSubstationCode(e.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          placeholder="14537"
          className={`${inputClass} mt-1 text-base`}
          required
        />
        {fieldErrors.substationCode && (
          <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.substationCode}</p>
        )}

        <label className="mt-3 block text-xs font-bold text-ink-soft" htmlFor="substationName">
          Substation name <span className="font-normal">(if you know it)</span>
        </label>
        <input
          id="substationName"
          value={substationName}
          onChange={(e) => setSubstationName(e.target.value)}
          placeholder="LEE PIC ACADEMY"
          className={`${inputClass} mt-1 text-base`}
        />
      </section>

      {/* --- 3. Where it is, in words -------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">3 · Location</h2>
        <label className="mt-3 block text-xs font-bold text-ink-soft" htmlFor="locationDescription">
          Describe the spot <span className="text-red-600">*</span>
        </label>
        <input
          id="locationDescription"
          value={locationDescription}
          onChange={(e) => setLocationDescription(e.target.value)}
          placeholder="Pole outside Lee Pic Academy gate, Wanyee Rd"
          className={`${inputClass} mt-1 text-base`}
          required
        />
        {fieldErrors.locationDescription && (
          <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.locationDescription}</p>
        )}
        {substationName && (
          <button
            type="button"
            onClick={() => setLocationDescription(`At substation ${substationCode} — ${substationName}`)}
            className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft"
          >
            Use “At substation {substationCode} — {substationName}”
          </button>
        )}
      </section>

      {/* --- 4. Photographs ------------------------------------------------- */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">4 · Photographs</h2>
        <p className="mt-1 text-xs text-ink-soft">
          The tank, and the rating plate if you can reach it. A photo now saves a second trip later.
        </p>
        <div className="mt-3">
          <PhotoUpload
            value={photoUrls}
            onChange={setPhotoUrls}
            max={5}
            label=""
            hint="Camera or gallery. Up to 5."
          />
        </div>
      </section>

      {/* --- 5. Nameplate: everything you can read, nothing you cannot ------ */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-sm font-bold text-navy">5 · Nameplate</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Leave anything blank that you cannot actually see. A blank is more useful than a guess.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-ink-soft" htmlFor="ratingKva">Rating</label>
            <select
              id="ratingKva"
              value={ratingKva}
              onChange={(e) => setRatingKva(e.target.value)}
              className={`${inputClass} mt-1 text-base`}
            >
              {RATINGS.map((r) => <option key={r} value={r}>{r} kVA</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft" htmlFor="manufacturerId">Manufacturer</label>
            <select
              id="manufacturerId"
              value={chosenMaker}
              onChange={(e) => setManufacturerId(e.target.value)}
              className={`${inputClass} mt-1 text-base`}
            >
              {manufacturers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft" htmlFor="serialNumber">Serial number</label>
            <input
              id="serialNumber"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              autoCapitalize="characters"
              placeholder="If visible"
              className={`${inputClass} mt-1 text-base`}
            />
            {fieldErrors.serialNumber && (
              <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.serialNumber}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-soft" htmlFor="yearOfManufacture">Year</label>
            <input
              id="yearOfManufacture"
              value={yearOfManufacture}
              onChange={(e) => setYearOfManufacture(e.target.value)}
              inputMode="numeric"
              placeholder="If visible"
              className={`${inputClass} mt-1 text-base`}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-ink-soft" htmlFor="gNumber">
              G-Number <span className="font-normal">(blank allocates the next one)</span>
            </label>
            <input
              id="gNumber"
              value={gNumber}
              onChange={(e) => setGNumber(e.target.value)}
              autoCapitalize="characters"
              placeholder="G-2026-00123"
              className={`${inputClass} mt-1 text-base`}
            />
            {fieldErrors.gNumber && (
              <p className="mt-1 text-xs font-semibold text-red-700">{fieldErrors.gNumber}</p>
            )}
          </div>
        </div>

        <label className="mt-3 block text-xs font-bold text-ink-soft" htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything worth knowing — leaking, leaning pole, missing earth."
          className={`${inputClass} mt-1 text-base`}
        />
      </section>

      {error && <FormError message={error} />}

      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-line bg-white/95 p-3 backdrop-blur-md md:static md:border-0 md:bg-transparent md:p-0">
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-xl bg-kplc py-3.5 text-sm font-bold text-white shadow-lg shadow-kplc/25 transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-ink-soft/40 disabled:shadow-none"
        >
          {busy ? "Saving…" : gpsReady ? "Onboard this transformer" : "Waiting for GPS…"}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-ink-soft">
          Recorded as onboarded by {engineerName}. No approval needed.
        </p>
      </div>
    </form>
  );
}
