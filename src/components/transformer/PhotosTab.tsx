"use client";

import Image from "next/image";
import { useState } from "react";
import { EmptyState } from "@/components/ui";
import { Lightbox, type LightboxPhoto } from "./Lightbox";
import type { StoryEvent } from "./story-types";
import { EVENT_META, formatDateTime } from "@/lib/format";

/**
 * Every photo, grouped by the event it belongs to. A photo without the context
 * of who took it, when, and during what event is just a picture — the grouping
 * is what makes it evidence.
 */
export function PhotosTab({ events }: { events: StoryEvent[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const withPhotos = events.filter((e) => e.photoUrls.length > 0);

  const flat: LightboxPhoto[] = [];
  const indexOf = new Map<string, number>();
  for (const event of withPhotos) {
    for (const url of event.photoUrls) {
      indexOf.set(url, flat.length);
      flat.push({
        url,
        caption: `${EVENT_META[event.type].label} · ${event.userName} · ${formatDateTime(event.occurredAt)}`,
      });
    }
  }

  if (withPhotos.length === 0) {
    return <EmptyState message="No photos have been taken for this transformer yet." />;
  }

  return (
    <div className="space-y-6">
      {withPhotos.map((event) => (
        <div key={event.id}>
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-sm font-bold text-navy">
              {EVENT_META[event.type].label}
            </h3>
            <span className="text-xs text-ink-soft">
              {event.userName} · {formatDateTime(event.occurredAt)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {event.photoUrls.map((url) => (
              <button
                key={url}
                type="button"
                onClick={() => setLightbox(indexOf.get(url) ?? 0)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-line"
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  unoptimized
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </div>
      ))}

      <Lightbox
        photos={flat}
        index={lightbox}
        onClose={() => setLightbox(null)}
        onNavigate={setLightbox}
      />
    </div>
  );
}
