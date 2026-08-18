"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGeolocation } from "@/lib/useGeolocation";
import { GpsCapture } from "@/components/field/GpsCapture";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { inputClass, FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { isWithinKenya } from "@/lib/geo";
import { ManufacturerPicker } from "@/components/manufacturer/ManufacturerPicker";

const RATINGS = [50, 100, 200, 315, 500, 1000];

type PositionMode = "auto" | "manual";

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

  // Auto-capture is the default and the hook fires it on mount. Manual entry is
  // the escape hatch for a phone that will not lock under a canopy or a
  // coordinate read off a handheld unit — it is never the first thing offered,
  // because a typed number is weaker evidence than a fix and the record grades
  // it accordingly.
  const [positionMode, setPositionMode] = useState<PositionMode>("auto");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  const [substationCode, setSubstationCode] = useState("");
  const [substationName, setSubstationName] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [gNumber, setGNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [makers, setMakers] = useState(manufacturers);
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
    () => makers.find((m) => /unknown/i.test(m.name))?.id ?? makers[0]?.id ?? "",
    [makers],
  );
  const chosenMaker = manufacturerId || unknownMaker;

  const gpsReady = state.status === "ready";

  // One resolved position, whichever way it arrived. Everything downstream —
  // the submit guard, the payload — reads this and never the two sources.
  const manualPos = useMemo(() => {
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (manualLat.trim() === "" || manualLng.trim() === "") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!isWithinKenya(lat, lng)) return null;
    return { lat, lng };
  }, [manualLat, manualLng]);

  const manualTouched = manualLat.trim() !== "" || manualLng.trim() !== "";
  const position =
    positionMode === "auto"
      ? gpsReady
        ? { lat: state.lat, lng: state.lng, accuracyM: Math.round(state.accuracyM), method: "GPS" as const }
        : null
      : manualPos
        ? { ...manualPos, accuracyM: undefined, method: "MANUAL" as const }
        : null;

  const canSubmit =
    position !== null && substationCode.trim() !== "" && locationDescription.trim().length >= 3 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!position) {
      setError(
        positionMode === "auto"
          ? "Wait for a GPS fix. That position is the whole point of doing this here."
          : "Enter a latitude and longitude inside Kenya before saving.",
      );
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/transformers/field-onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: position.lat,
          lng: position.lng,
          accuracyM: position.accuracyM,
          positionMethod: position.method,
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
          {positionMode === "auto"
            ? "This fix becomes the transformer's position, marked as surveyed because you are here."
            : "A typed coordinate is recorded as estimated, not surveyed. Use auto-capture whenever the phone will lock."}
        </p>

        <div
          role="radiogroup"
          aria-label="How to set the position"
          className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
        >
          {(
            [
              { mode: "auto" as const, label: "📍 Auto-capture" },
              { mode: "manual" as const, label: "⌨️ Manual entry" },
            ]
          ).map((opt) => (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={positionMode === opt.mode}
              onClick={() => {
                setPositionMode(opt.mode);
                if (opt.mode === "auto" && state.status !== "ready") capture();
              }}
              className={`inline-flex min-h-11 items-center justify-center rounded-lg text-xs font-bold transition-colors ${
                positionMode === opt.mode ? "bg-white text-navy shadow-sm" : "text-ink-soft"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {positionMode === "auto" ? (
          <div className="mt-3">
            <GpsCapture state={state} onRetry={capture} required />
          </div>
        ) : (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-ink-soft" htmlFor="manualLat">
                  Latitude <span className="text-red-600">*</span>
                </label>
                <input
                  id="manualLat"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  inputMode="decimal"
                  placeholder="-1.28640"
                  className={`${inputClass} mt-1 font-mono text-base`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-ink-soft" htmlFor="manualLng">
                  Longitude <span className="text-red-600">*</span>
                </label>
                <input
                  id="manualLng"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  inputMode="decimal"
                  placeholder="36.81720"
                  className={`${inputClass} mt-1 font-mono text-base`}
                />
              </div>
            </div>

            {manualTouched && !manualPos && (
              <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                That is not a point inside Kenya. Check the decimal places — Nairobi is about
                -1.28, 36.81.
              </p>
            )}
            {manualPos && (
              <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                ⚠️ Typed coordinate accepted. It is recorded as estimated, not surveyed, and this
                unit will not count as position-verified.
              </p>
            )}
          </div>
        )}
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
            <div className="mt-1">
              <ManufacturerPicker
                manufacturers={makers}
                value={chosenMaker}
                onChange={setManufacturerId}
                onCreated={(m) => setMakers((prev) => [...prev, m])}
              />
            </div>
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
          {busy
            ? "Saving…"
            : position
              ? "Onboard this transformer"
              : positionMode === "auto"
                ? "Waiting for GPS…"
                : "Enter coordinates…"}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-ink-soft">
          Recorded as onboarded by {engineerName}. No approval needed.
        </p>
      </div>
    </form>
  );
}
