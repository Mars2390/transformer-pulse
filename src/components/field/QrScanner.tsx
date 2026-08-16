"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, FormError } from "@/components/ui/Field";

/**
 * Scanning a transformer's QR code in the field.
 *
 * Uses the browser's native BarcodeDetector where it exists — Chrome on Android,
 * which is what the field engineers are carrying — rather than shipping a
 * 300 KB decoder to a phone on LTE. Where it does not exist the screen does not
 * pretend: it says so and offers the G-Number box, which was always going to be
 * the fallback anyway.
 *
 * The PIN gate in front of this is a deterrent, not a control. Everyone reaching
 * this page is already signed in to a KPLC account; the story page it leads to
 * requires that sign-in regardless of how you arrived. Worth knowing so nobody
 * mistakes four shared digits for the thing keeping the register private.
 */
export function QrScanner({ usingDefaultPin }: { usingDefaultPin: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function checkPin(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/settings/qr-pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        setPinError("That is not the PIN.");
        return;
      }
      setUnlocked(true);
    } catch {
      setPinError("Could not check the PIN. Try again.");
    } finally {
      setChecking(false);
    }
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code"] });

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes?.length) {
            const raw = String(codes[0].rawValue ?? "");
            streamRef.current.getTracks().forEach((t) => t.stop());
            setScanning(false);
            go(raw);
            return;
          }
        } catch {
          // A frame that cannot be decoded is the normal case, not an error.
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setError("Could not open the camera. Allow camera access, or type the G-Number below.");
    }
  }

  /** A code may be a full URL or a bare G-Number. Both must work. */
  function go(raw: string) {
    const value = raw.trim();
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        router.push(url.pathname + url.search);
        return;
      } catch {
        // fall through to G-Number handling
      }
    }
    const g = value.match(/G-?\d{4}-?\d{1,6}/i);
    if (g) {
      router.push(`/t/${encodeURIComponent(g[0].toUpperCase())}`);
      return;
    }
    setError(`That code does not look like a transformer tag: "${value.slice(0, 40)}"`);
  }

  if (!unlocked) {
    return (
      <form onSubmit={checkPin} className="mx-auto max-w-xs space-y-3 rounded-2xl border border-line bg-white p-5">
        <p className="text-sm font-bold text-navy">Enter the KPLC scanner PIN</p>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="••••"
          className={`${inputClass} text-center text-2xl tracking-[0.6em]`}
        />
        {pinError && <p className="text-xs font-semibold text-red-700">{pinError}</p>}
        {usingDefaultPin && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-800">
            Still on the factory PIN. An admin should change it under Settings.
          </p>
        )}
        <button
          type="submit"
          disabled={pin.length !== 4 || checking}
          className="w-full rounded-xl bg-kplc py-3 text-sm font-bold text-white disabled:bg-ink-soft/40"
        >
          {checking ? "Checking…" : "Unlock scanner"}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {supported === false && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          This browser cannot scan QR codes. Type the G-Number instead — it is printed on the label
          under the code.
        </p>
      )}

      {supported && (
        <div className="overflow-hidden rounded-2xl border border-line bg-black">
          <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
        </div>
      )}

      {supported && !scanning && (
        <button
          type="button"
          onClick={start}
          className="w-full rounded-xl bg-kplc py-3.5 text-sm font-bold text-white"
        >
          📱 Start scanning
        </button>
      )}
      {scanning && (
        <p className="text-center text-sm font-semibold text-ink-soft">
          Point the camera at the label…
        </p>
      )}

      {error && <FormError message={error} />}

      <div className="rounded-2xl border border-line bg-white p-4">
        <label className="block text-xs font-bold text-ink-soft" htmlFor="manual-g">
          Or type the G-Number
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="manual-g"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            autoCapitalize="characters"
            placeholder="G-2026-00042"
            className={`${inputClass} text-base`}
          />
          <button
            type="button"
            onClick={() => go(manual)}
            disabled={!manual.trim()}
            className="shrink-0 rounded-xl bg-navy px-4 text-sm font-bold text-white disabled:opacity-40"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}
