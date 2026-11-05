"use client";

import { useEffect, useRef } from "react";

/** Wraps a sideways-scrolling bar and brings the selected item ([aria-current]) into view. */
export function ScrollActiveIntoView({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const active = box?.querySelector<HTMLElement>("[aria-current='page']");
    if (!box || !active) return;
    const left = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
