"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fades its children in as they scroll into view.
 *
 * Always renders a plain div — a wrapper carries no semantics, so put the
 * meaningful tag (article, section, li) on the element inside.
 *
 * The observer disconnects after firing: the animation plays once, not every
 * time the user scrolls back past it, which would be nauseating during a live
 * demo on a projector.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  /** Stagger, in milliseconds. Keep under ~350ms or the page feels slow. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
