import Image from "next/image";
import Link from "next/link";
import { IconArrowRight } from "@/components/marketing/icons";

/**
 * The hero.
 *
 * One transformer, on a bright ground, stated plainly. No carousel: a slideshow
 * asks the viewer to wait to find out what the product is. A single clear
 * subject says it immediately, and it is the honest image — this is the asset
 * the whole system exists to track.
 *
 * The photograph is a product shot on a white background. Rather than sit it in
 * a white box on a grey page, `mix-blend-multiply` drops its white away so the
 * unit stands directly on the page. This works because every colour behind it
 * is light — do not put this image on a dark panel.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-gradient-to-b from-white via-white to-surface pb-20 pt-32 sm:pb-28 sm:pt-40">
      {/* Engineering grid, faded out toward the edges. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #1e40af12 1px, transparent 1px), linear-gradient(to bottom, #1e40af12 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 75% 70% at 55% 45%, black 30%, transparent 100%)",
        }}
        aria-hidden="true"
      />

      {/* Warm gold wash, top right — keeps a very light page from going flat. */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-[26rem] w-[26rem] rounded-full bg-gold/12 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-8">
        {/* ---------------- Words ------------------------------------------ */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-kplc/15 bg-kplc/6 px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-kplc sm:text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-gold animate-blink" />
            Distribution transformer portal
          </span>

          {/* The product name is the headline. Nothing else competes with it. */}
          <h1 className="mt-7 text-[clamp(2.6rem,7vw,4.8rem)] font-extrabold tracking-[-0.03em] text-navy">
            Transformer
            <span className="relative ml-3 whitespace-nowrap">
              <span className="relative z-10">Pulse</span>
              {/* Gold highlighter behind the second word — one accent, once. */}
              <span
                className="absolute inset-x-0 bottom-[0.09em] z-0 h-[0.3em] rounded-sm bg-gold/45"
                aria-hidden="true"
              />
            </span>
          </h1>

          <p className="mt-6 max-w-md text-[clamp(1.15rem,2.2vw,1.5rem)] font-semibold leading-snug text-ink-soft">
            Track every transformer in real time.
          </p>

          <p className="mt-7 text-sm font-bold tracking-[0.12em] text-kplc">
            LOCATE. TRACK. TEST. RECOVER.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/dashboard"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-kplc px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-kplc/25 transition-all hover:-translate-y-0.5 hover:bg-kplc-light hover:shadow-xl hover:shadow-kplc/30"
            >
              Open dashboard
              <span className="h-4 w-4 transition-transform group-hover:translate-x-0.5">
                <IconArrowRight />
              </span>
            </Link>
            <a
              href="#how"
              className="inline-flex items-center justify-center rounded-xl border border-navy/15 bg-white px-6 py-3.5 text-sm font-semibold text-navy transition-all hover:-translate-y-0.5 hover:border-navy/35 hover:shadow-md"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* ---------------- The transformer -------------------------------- */}
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          {/* Pulse rings — the name of the product, drawn. They sit behind the
              unit and expand outward on a long, slow cycle. */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[85%] w-[85%] -translate-x-1/2 -translate-y-1/2"
            aria-hidden="true"
          >
            <span className="absolute inset-0 rounded-full border border-kplc/20 animate-pulse-ring" />
            <span
              className="absolute inset-0 rounded-full border border-kplc/20 animate-pulse-ring"
              style={{ animationDelay: "1.6s" }}
            />
            <span
              className="absolute inset-0 rounded-full border border-gold/35 animate-pulse-ring"
              style={{ animationDelay: "3.2s" }}
            />
          </div>

          {/* Soft ground shadow so the unit does not float in a vacuum. */}
          <div
            className="pointer-events-none absolute bottom-[8%] left-1/2 -z-10 h-10 w-[62%] -translate-x-1/2 rounded-[50%] bg-navy/15 blur-2xl"
            aria-hidden="true"
          />

          <Image
            src="/images/transformer-unit.jpg"
            alt="An oil-immersed distribution transformer with HV and LV bushings."
            width={554}
            height={554}
            priority
            sizes="(max-width: 1024px) 90vw, 45vw"
            className="relative h-auto w-full mix-blend-multiply"
          />
        </div>
      </div>
    </section>
  );
}
