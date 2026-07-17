"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
} from "@/components/marketing/icons";

/**
 * Horizontally scrolling photo strip.
 *
 * Built on native scroll with CSS snap rather than a JS carousel: touch-swipe,
 * momentum, keyboard and screen-reader behaviour all come free and correct
 * from the browser. The arrows just nudge scrollLeft.
 */

const PHOTOS = [
  {
    src: "/images/transformer-unit.jpg",
    title: "At the manufacturer",
    caption: "Serial number, rating and year captured on delivery.",
  },
  {
    src: "/images/transformer-in-transit.jpg",
    title: "In transit",
    caption: "Vehicle, number plate and driver recorded on dispatch.",
  },
  {
    src: "/images/transformer-installation.jpg",
    title: "Installation",
    caption: "GPS point and photograph taken at the pole.",
  },
  {
    src: "/images/pole-mounted-transformer.jpg",
    title: "In service",
    caption: "Inspections logged against the same record.",
  },
  {
    src: "/images/field-crew-truck.jpg",
    title: "Field teams",
    caption: "Recorded from a phone, at the site, as the work happens.",
  },
  {
    src: "/images/substation-switchyard.jpg",
    title: "Across the network",
    caption: "Every unit visible on one map.",
  },
];

export function PhotoStrip() {
  const scroller = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Disable arrows at the ends so nobody clicks a button that does nothing.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;

    const update = () => {
      setAtStart(node.scrollLeft < 8);
      setAtEnd(node.scrollLeft + node.clientWidth >= node.scrollWidth - 8);
    };

    update();
    node.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      node.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const nudge = (direction: -1 | 1) => {
    const node = scroller.current;
    if (!node) return;
    // Scroll by roughly one card, whatever the breakpoint made a card.
    const card = node.querySelector("[data-card]") as HTMLElement | null;
    const step = card ? card.offsetWidth + 20 : node.clientWidth * 0.8;
    node.scrollBy({ left: step * direction, behavior: "smooth" });
  };

  return (
    <div>
      <div className="mx-auto flex max-w-7xl items-end justify-between gap-6 px-5 sm:px-8">
        <div>
          <p className="text-xs font-bold tracking-[0.14em] text-kplc">
            ACROSS THE NETWORK
          </p>
          <h2 className="mt-3 text-[clamp(1.6rem,3.4vw,2.4rem)] font-extrabold text-navy">
            One record, from factory to feeder
          </h2>
        </div>

        <div className="hidden shrink-0 gap-2 sm:flex">
          <button
            type="button"
            onClick={() => nudge(-1)}
            disabled={atStart}
            className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-navy transition-all hover:border-kplc hover:text-kplc disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-navy"
            aria-label="Previous photos"
          >
            <span className="h-5 w-5">
              <IconChevronLeft />
            </span>
          </button>
          <button
            type="button"
            onClick={() => nudge(1)}
            disabled={atEnd}
            className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-navy transition-all hover:border-kplc hover:text-kplc disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-navy"
            aria-label="Next photos"
          >
            <span className="h-5 w-5">
              <IconChevronRight />
            </span>
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        className="no-scrollbar mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-5 pb-2 sm:px-8"
      >
        {PHOTOS.map((photo) => (
          <figure
            key={photo.src}
            data-card
            className="group w-[76vw] shrink-0 snap-start overflow-hidden rounded-2xl border border-line bg-white transition-all duration-300 hover:-translate-y-1.5 hover:border-kplc/40 hover:shadow-xl hover:shadow-navy/8 sm:w-[46vw] lg:w-[calc((100%-60px)/4)]"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
              <Image
                src={photo.src}
                alt={photo.title}
                fill
                sizes="(max-width: 640px) 76vw, (max-width: 1024px) 46vw, 25vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-107"
              />
            </div>
            <figcaption className="p-4">
              <p className="text-sm font-bold text-navy">{photo.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-soft">
                {photo.caption}
              </p>
            </figcaption>
          </figure>
        ))}

        {/* Trailing spacer so the last card can snap clear of the edge. */}
        <div className="w-1 shrink-0 sm:w-3" aria-hidden="true" />
      </div>
    </div>
  );
}
