"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { FormError } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatRelative } from "@/lib/format";

export type PresenceRow = {
  id: string;
  transformerId: string;
  label: string;
  rating: string;
  movementLabel: string;
  fromName: string;
  toName: string;
  raisedByName: string;
  raisedAt: string;
  status: string;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
};

/**
 * "You are named on these. Confirm you are at the pole."
 *
 * The one thing on a field engineer's dashboard that nobody else can do for
 * them. A keeper, a store manager or a regional manager may all raise a
 * movement out of a site and name the engineer on it; only the engineer can say
 * they are standing there, and the lorry cannot leave until they have.
 *
 * The GPS fix is attempted but never required. Demanding one would make
 * confirmation impossible in a valley with no signal — and an engineer who
 * cannot confirm will telephone the store and have somebody else press the
 * button, which is the exact fiction this control exists to prevent. When a fix
 * IS available it is recorded, so the honest cases carry more evidence than the
 * rest without the dishonest ones being forced.
 */
export function PresenceConfirmList({ rows }: { rows: PresenceRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(row: PresenceRow) {
    setError(null);
    setBusy(row.id);

    // Best effort, 8 seconds, then give up and send it without. The
    // confirmation is the point; the coordinates are a bonus.
    const fix = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      );
    });

    try {
      const res = await fetch(`/api/transactions/${row.id}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          fix
            ? {
                lat: fix.coords.latitude,
                lng: fix.coords.longitude,
                accuracyM: Math.round(fix.coords.accuracy),
              }
            : {},
        ),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not record your confirmation.");
        return;
      }
      toast(data.message ?? "Presence confirmed.", "success");
      router.refresh();
    } catch {
      setError("No connection. Your confirmation was not recorded — try again when you have signal.");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
        A transformer cannot leave a site until the engineer named on the movement confirms they are
        there. Nobody can do this on your behalf.
      </p>

      {error && <FormError message={error} />}

      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/transformers/${r.transformerId}`}
                className="text-sm font-bold text-navy hover:text-kplc"
              >
                {r.label}
              </Link>
              <span className="text-xs text-ink-soft">{r.rating}</span>
              <Badge tone="warning">{r.movementLabel}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">
              {r.fromName} → {r.toName}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              Raised by {r.raisedByName} · {formatRelative(new Date(r.raisedAt))}
            </p>
            {r.vehiclePlate && (
              <p className="mt-0.5 text-xs text-ink-soft">
                Vehicle {r.vehiclePlate}
                {r.driverName ? ` · ${r.driverName}` : ""}
                {r.driverPhone ? (
                  <>
                    {" · "}
                    <a href={`tel:${r.driverPhone}`} className="font-semibold text-kplc">
                      {r.driverPhone}
                    </a>
                  </>
                ) : null}
              </p>
            )}

            <button
              type="button"
              onClick={() => confirm(r)}
              disabled={busy === r.id}
              className="mt-3 min-h-12 w-full rounded-xl bg-kplc px-5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy === r.id ? "Getting your location…" : "I am present at site — movement can proceed"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
