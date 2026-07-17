"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { resizeImage } from "@/lib/imageResize";

/**
 * Photo capture and upload.
 *
 * `capture="environment"` opens the rear camera directly on a phone rather than
 * the gallery — the field engineer's default action is "take a photo now", not
 * "go hunting through your camera roll".
 *
 * Uploaded URLs are surfaced through `onChange`, so the parent form owns the
 * list and can submit it as `photoUrls[]`.
 */

type Item = {
  id: string;
  status: "resizing" | "uploading" | "done" | "error";
  url?: string;
  preview: string; // local object URL, shown while uploading
  error?: string;
};

export function PhotoUpload({
  value,
  onChange,
  max = 5,
  label = "Photos",
  hint,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  label?: string;
  hint?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (next: Item[]) => {
    setItems(next);
    onChange(next.filter((i) => i.status === "done" && i.url).map((i) => i.url!));
  };

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;

    const room = max - items.filter((i) => i.status !== "error").length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));

    for (const file of chosen) {
      const id = crypto.randomUUID();
      const preview = URL.createObjectURL(file);

      setItems((prev) => [...prev, { id, status: "resizing", preview }]);

      try {
        const resized = await resizeImage(file);
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, status: "uploading" } : i)),
        );

        const body = new FormData();
        body.append("file", resized);
        const response = await fetch("/api/upload", { method: "POST", body });
        const data = await response.json();

        if (!response.ok) throw new Error(data.error ?? "Upload failed.");

        setItems((prev) => {
          const next = prev.map((i) =>
            i.id === id ? { ...i, status: "done" as const, url: data.url } : i,
          );
          onChange(next.filter((x) => x.status === "done" && x.url).map((x) => x.url!));
          return next;
        });
      } catch (error) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === id
              ? { ...i, status: "error", error: (error as Error).message }
              : i,
          ),
        );
      }
    }

    if (inputRef.current) inputRef.current.value = ""; // allow re-picking the same file
  }

  function remove(id: string) {
    commit(items.filter((i) => i.id !== id));
  }

  const activeCount = items.filter((i) => i.status !== "error").length;

  return (
    <div>
      <p className="text-xs font-bold text-navy">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}

      <div className="mt-2 flex flex-wrap gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="relative h-24 w-24 overflow-hidden rounded-xl border border-line bg-surface-2"
          >
            <Image
              src={item.url ?? item.preview}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
              unoptimized // blob + object URLs are already sized; skip the optimizer
            />

            {(item.status === "resizing" || item.status === "uploading") && (
              <div className="absolute inset-0 grid place-items-center bg-navy-dark/55">
                <span className="text-[10px] font-bold text-white">
                  {item.status === "resizing" ? "Resizing…" : "Uploading…"}
                </span>
              </div>
            )}

            {item.status === "error" && (
              <div className="absolute inset-0 grid place-items-center bg-red-600/80 p-1 text-center">
                <span className="text-[9px] font-bold text-white">{item.error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => remove(item.id)}
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-navy-dark/70 text-xs font-bold text-white transition-colors hover:bg-red-600"
              aria-label="Remove photo"
            >
              ×
            </button>
          </div>
        ))}

        {activeCount < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="grid h-24 w-24 place-items-center rounded-xl border-2 border-dashed border-line text-ink-soft transition-colors hover:border-kplc hover:text-kplc"
          >
            <span className="text-center text-[11px] font-bold leading-tight">
              + Add
              <br />
              photo
            </span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  );
}
