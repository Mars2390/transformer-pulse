"use client";

import { useEffect, useState } from "react";
import { IconArrowUp } from "@/components/marketing/icons";

/** Appears once the user is a screen or so down the page. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-6 right-5 z-40 grid h-11 w-11 place-items-center rounded-full bg-kplc text-white shadow-xl shadow-navy/30 transition-all duration-300 hover:-translate-y-0.5 hover:bg-gold hover:text-navy-dark sm:right-8 ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0"
      }`}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
    >
      <span className="h-5 w-5">
        <IconArrowUp />
      </span>
    </button>
  );
}
