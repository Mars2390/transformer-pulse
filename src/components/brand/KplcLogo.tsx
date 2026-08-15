import Image from "next/image";

/**
 * The brand lock-up: the Kenya Power mark in a white tile, followed by the
 * Transformer DNA wordmark.
 *
 * The tile is not decoration. The supplied logo is a solid white square, so on
 * a navy navbar it needs a deliberate container or it reads as a sticker
 * someone pasted on. `overflow-hidden` plus a slight scale also crops the dark
 * vignette left in the corners of the source file.
 */

export function KplcMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white ${className}`}
    >
      <Image
        src="/images/kenya-power-logo.png"
        alt="Kenya Power"
        width={415}
        height={417}
        className="h-full w-full scale-110 object-contain"
        priority
      />
    </span>
  );
}

export function BrandLockup({
  tone = "light",
  className = "",
}: {
  /** "light" = for dark backgrounds. "dark" = for white backgrounds. */
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <KplcMark className="h-10 w-10" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-extrabold tracking-tight">
          <span className={tone === "light" ? "text-white" : "text-navy"}>
            Transformer
          </span>
          <span className="text-gold">DNA</span>
        </span>
        <span
          className={`mt-1 text-[10px] font-medium tracking-tight ${
            tone === "light" ? "text-white/55" : "text-ink-soft"
          }`}
        >
          Kenya Power Distribution Assets
        </span>
      </span>
    </span>
  );
}
