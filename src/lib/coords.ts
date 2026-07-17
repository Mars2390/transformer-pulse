import { z } from "zod";
import { KENYA_BOUNDS } from "./geo";

/** Latitude / longitude validators, bounded to Kenya. Shared across schemas. */

export const latitude = z
  .coerce.number()
  .min(KENYA_BOUNDS.minLat, "That latitude is outside Kenya.")
  .max(KENYA_BOUNDS.maxLat, "That latitude is outside Kenya.");

export const longitude = z
  .coerce.number()
  .min(KENYA_BOUNDS.minLng, "That longitude is outside Kenya.")
  .max(KENYA_BOUNDS.maxLng, "That longitude is outside Kenya.");
