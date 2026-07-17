"use client";

import Image from "next/image";
import { useEffect } from "react";

export type LightboxPhoto = {
  url: string;
  caption: string;
};

/**
 * Full-screen photo viewer. Escape or a click on the backdrop closes it; the
 * arrow keys move between photos. Rendered by whichever tab holds the photos.
 */
export function Lightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: LightboxPhoto[];
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    if (index == null) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNavigate((index + 1) % photos.length);
      if (e.key === "ArrowLeft") onNavigate((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, photos.length, onClose, onNavigate]);

  if (index == null) return null;
  const photo = photos[index];

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-navy-dark/92 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl font-bold text-white transition-colors hover:bg-white/20"
        aria-label="Close"
      >
        ×
      </button>

      <div
        className="relative flex max-h-[80vh] max-w-4xl items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => onNavigate((index - 1 + photos.length) % photos.length)}
            className="absolute -left-4 z-10 grid h-11 w-11 -translate-x-full place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 max-sm:left-2 max-sm:translate-x-0"
            aria-label="Previous"
          >
            ‹
          </button>
        )}

        <Image
          src={photo.url}
          alt={photo.caption}
          width={1200}
          height={900}
          unoptimized
          className="max-h-[80vh] w-auto rounded-xl object-contain"
        />

        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => onNavigate((index + 1) % photos.length)}
            className="absolute -right-4 z-10 grid h-11 w-11 translate-x-full place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 max-sm:right-2 max-sm:translate-x-0"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>

      <div className="mt-4 text-center">
        <p className="text-sm font-medium text-white">{photo.caption}</p>
        <p className="mt-1 text-xs text-white/50">
          {index + 1} of {photos.length}
        </p>
      </div>
    </div>
  );
}
