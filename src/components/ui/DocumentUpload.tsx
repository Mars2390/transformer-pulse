"use client";

import { useRef, useState } from "react";

/**
 * Single-document capture and upload — PDF or a photo of a paper report.
 *
 * Unlike PhotoUpload (multiple images, resized client-side, camera by
 * default) this is one document, not resized (a scanned PDF or a photographed
 * certificate loses nothing by staying full-size under the 10 MB ceiling),
 * and opens the file picker rather than the camera by default — most FAT
 * reports arrive as a PDF someone already has on their phone or laptop.
 */

type State =
  | { status: "idle" }
  | { status: "uploading"; name: string }
  | { status: "done"; name: string; url: string }
  | { status: "error"; message: string };

export function DocumentUpload({
  value,
  onChange,
  label = "Attach document",
  hint,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  hint?: string;
}) {
  const [state, setState] = useState<State>(value ? { status: "done", name: "Attached document", url: value } : { status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setState({ status: "uploading", name: file.name });

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Upload failed.");

      setState({ status: "done", name: file.name, url: data.url });
      onChange(data.url);
    } catch (error) {
      setState({ status: "error", message: (error as Error).message });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    setState({ status: "idle" });
    onChange(null);
  }

  return (
    <div>
      <p className="text-xs font-bold text-navy">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}

      <div className="mt-2">
        {state.status === "idle" && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border-2 border-dashed border-line px-4 py-3 text-xs font-bold text-ink-soft transition-colors hover:border-kplc hover:text-kplc"
          >
            📎 {label}
          </button>
        )}

        {state.status === "uploading" && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-kplc border-t-transparent" />
            <span className="text-ink-soft">Uploading {state.name}…</span>
          </div>
        )}

        {state.status === "done" && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-xs">
            <span className="text-lg">📄</span>
            <a href={state.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-bold text-navy hover:text-kplc">
              {state.name}
            </a>
            <button type="button" onClick={clear} className="shrink-0 font-bold text-red-600 hover:text-red-700">
              Remove
            </button>
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs">
            <p className="font-bold text-red-700">{state.message}</p>
            <button type="button" onClick={() => setState({ status: "idle" })} className="mt-1 font-bold text-navy hover:text-kplc">
              Try again
            </button>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />
    </div>
  );
}
