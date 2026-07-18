import { IconPin } from "@/components/marketing/icons";

/**
 * Opens the device's maps app at a transformer's coordinates.
 *
 * A plain Google Maps deep link — on a phone this hands off to the native maps
 * app and turn-by-turn navigation, which is exactly what a field engineer needs
 * to actually reach the pole. No SDK, no key.
 */
export function NavigateButton({
  lat,
  lng,
  label = "Navigate",
  className = "",
}: {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-kplc/25 bg-kplc/5 px-3 py-2 text-xs font-bold text-kplc transition-colors hover:bg-kplc/10 ${className}`}
    >
      <span className="h-4 w-4">
        <IconPin />
      </span>
      {label}
    </a>
  );
}
