"use client";

import { useCallback, useEffect, useState } from "react";
import { isWithinKenya } from "./geo";

/**
 * GPS capture for field forms.
 *
 * Fires automatically on mount — a field engineer must never have to press
 * "get location". Reports accuracy so the UI can colour it, and rejects a fix
 * outside Kenya (a phone with no signal reports 0,0, and Null Island is not a
 * KPLC site).
 */

export type GpsState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; lat: number; lng: number; accuracyM: number }
  | { status: "denied" }
  | { status: "unavailable"; message: string }
  | { status: "out_of_bounds"; lat: number; lng: number };

export function useGeolocation(autoStart = true) {
  const [state, setState] = useState<GpsState>({ status: "idle" });

  const capture = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "unavailable", message: "This device has no GPS." });
      return;
    }

    setState({ status: "locating" });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!isWithinKenya(latitude, longitude)) {
          setState({ status: "out_of_bounds", lat: latitude, lng: longitude });
          return;
        }
        setState({
          status: "ready",
          lat: latitude,
          lng: longitude,
          accuracyM: accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setState({ status: "denied" });
        } else {
          setState({
            status: "unavailable",
            message:
              error.code === error.TIMEOUT
                ? "Could not get a fix in time. Move to open sky and retry."
                : "Location is unavailable right now.",
          });
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    if (autoStart) capture();
  }, [autoStart, capture]);

  return { state, capture };
}
