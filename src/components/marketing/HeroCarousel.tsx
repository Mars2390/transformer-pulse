"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowRight,
  IconPause,
  IconPlay,
} from "@/components/marketing/icons";

/**
 * The cinematic hero.
 *
 * Slides crossfade while the active image slowly pushes in (Ken Burns). It
 * auto-advances, and pauses on hover, on keyboard focus, and whenever the tab
 * is hidden — a carousel that keeps cycling in a background tab burns a field
 * engineer's phone battery and their data bundle for nothing.
 */

const SLIDES = [
  {
    src: "/images/transformer-installation.jpg",
    alt: "A Kenya Power crew lifting a distribution transformer onto a pole with a truck-mounted crane.",
  },
  {
    src: "/images/transformer-in-transit.jpg",
    alt: "A power transformer strapped to the bed of a lorry during transport.",
  },
  {
    src: "/images/field-crew-truck.jpg",
    alt: "A Kenya Power field team working from a bucket truck on an urban street.",
  },
  {
    src: "/images/grid-transmission-line.jpg",
    alt: "Transmission towers crossing open grassland with zebra in the foreground.",
  },
  {
    src: "/images/substation-switchyard.jpg",
    alt: "Switchgear and busbars inside an electrical substation yard.",
  },
];

const SLIDE_DURATION_MS = 6000;

export function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  // Stop advancing while the tab is in the background.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const advance = useCallback(() => {
    setIndex((i) => (i + 1) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (paused || userPaused) return;
    const timer = setTimeout(advance, SLIDE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [index, paused, userPaused, advance]);

  return (
    <section
      className="relative isolate min-h-[85svh] overflow-hidden bg-navy-dark sm:min-h-[92svh]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Transformer Pulse"
    >
      {/* --- Slides --------------------------------------------------------- */}
      {SLIDES.map((slide, i) => {
        const active = i === index;
        return (
          <div
            key={slide.src}
            className={`absolute inset-0 transition-opacity duration-[1400ms] ease-out ${
              active ? "opacity-100" : "opacity-0"
            }`}
            aria-hidden={!active}
          >
            <div
              // Re-keying on the index restarts the Ken Burns push for each
              // new slide instead of resuming a half-finished one.
              key={active ? `active-${index}` : "idle"}
              className={active && !reducedMotion.current ? "h-full w-full animate-ken-burns" : "h-full w-full"}
            >
              <Image
                src={slide.src}
                alt={active ? slide.alt : ""}
                fill
                priority={i === 0}
                sizes="100vw"
                className="object-cover object-center"
              />
            </div>
          </div>
        );
      })}

      {/* --- Legibility overlays -------------------------------------------
          Two layers: a vertical gradient anchoring the text to the bottom-left,
          and a horizontal one so the headline never fights a bright sky. */}
      <div className="absolute inset-0 bg-gradient-to-t from-navy-dark via-navy-dark/70 to-navy-dark/25" />
      <div className="absolute inset-0 bg-gradient-to-r from-navy-dark/90 via-navy-dark/45 to-transparent" />

      {/* --- Content -------------------------------------------------------- */}
      <div className="relative z-10 mx-auto flex min-h-[85svh] max-w-7xl flex-col justify-center px-5 pb-28 pt-32 sm:min-h-[92svh] sm:px-8">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur-md sm:text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-gold animate-blink" />
          Distribution transformer portal
        </span>

        <h1 className="mt-6 max-w-3xl text-[clamp(2.1rem,6vw,4rem)] font-extrabold text-white">
          Transformer tracking and asset
          <br className="hidden sm:block" /> management for{" "}
          <span className="text-gold">Kenya Power</span>
        </h1>

        <p className="mt-5 text-[clamp(1rem,2.2vw,1.35rem)] font-semibold text-white/85">
          Locate. Track. Test. Recover.
        </p>

        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/65 sm:text-base">
          Every transformer carries a record of where it came from, who moved
          it, where it stands today, and what it is worth under warranty.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/dashboard"
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-kplc px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-kplc/30 transition-all hover:-translate-y-0.5 hover:bg-kplc-light hover:shadow-xl hover:shadow-kplc/40"
          >
            Open dashboard
            <span className="h-4 w-4 transition-transform group-hover:translate-x-0.5">
              <IconArrowRight />
            </span>
          </Link>
          <a
            href="#how"
            className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/10"
          >
            See how it works
          </a>
        </div>

        {/* --- Controls ---------------------------------------------------- */}
        <div className="mt-12 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setUserPaused((v) => !v)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
            aria-label={userPaused ? "Play slideshow" : "Pause slideshow"}
          >
            <span className="h-4 w-4">
              {userPaused ? <IconPlay /> : <IconPause />}
            </span>
          </button>

          <div className="flex items-center gap-2">
            {SLIDES.map((slide, i) => (
              <button
                key={slide.src}
                type="button"
                onClick={() => setIndex(i)}
                className="group py-2"
                aria-label={`Go to slide ${i + 1} of ${SLIDES.length}`}
                aria-current={i === index}
              >
                <span
                  className={`block h-[3px] rounded-full transition-all duration-500 ${
                    i === index
                      ? "w-9 bg-gold"
                      : "w-5 bg-white/30 group-hover:bg-white/60"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
