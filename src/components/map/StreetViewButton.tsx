/**
 * Opens Google Street View at a transformer's coordinates, in a new tab.
 *
 * A server component on purpose — it is a plain link, and shipping JavaScript
 * for something an anchor already does would be waste. `layer=c` is what puts
 * Google Maps into Street View rather than the ordinary map.
 *
 * Worth knowing at the point of use: Street View imagery is whatever Google
 * last drove past, often several years old. It is good for "is there a pole
 * here, what does the approach look like" and useless for "is the transformer
 * still there today". That second question is what a field inspection answers.
 */
export function StreetViewButton({
  lat,
  lng,
  label = "Street View",
  className,
}: {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}&layer=c`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-navy transition-colors hover:border-kplc hover:text-kplc"
      }
    >
      🗺️ {label}
    </a>
  );
}
