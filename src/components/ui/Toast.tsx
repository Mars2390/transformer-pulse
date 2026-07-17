"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Minimal toast system. A confirmation after a field action must be visible and
 * then get out of the way — no library needed for that.
 */

type Toast = { id: string; message: string; tone: "success" | "error" };

const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-8">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDone={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      role="status"
      className={`pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl ${
        toast.tone === "success" ? "bg-kplc" : "bg-red-600"
      }`}
      style={{ animation: "fade-up 0.3s cubic-bezier(0.16,1,0.3,1)" }}
    >
      {toast.message}
    </div>
  );
}
