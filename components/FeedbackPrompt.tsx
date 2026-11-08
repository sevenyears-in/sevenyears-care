"use client";

import { useEffect, useState } from "react";

export type PendingFeedback = { label: string; detail: string; href: string };

/** Pops up once per visit after login when there is something the customer can rate. */
export function FeedbackPrompt({ items, sessionKey }: { items: PendingFeedback[]; sessionKey: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!items.length) return;
    try {
      if (sessionStorage.getItem(sessionKey)) return;
      sessionStorage.setItem(sessionKey, "1");
    } catch {
      /* storage blocked — still ask */
    }
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [items.length, sessionKey]);

  if (!open || !items.length) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="h-1.5 bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
        <div className="p-6">
          <p className="text-3xl" aria-hidden>
            ⭐
          </p>
          <h2 className="mt-2 text-xl font-bold">How did we do?</h2>
          <p className="mt-1 text-sm text-black/55">Your feedback takes less than a minute and helps us serve you better.</p>
          <div className="mt-4 space-y-2">
            {items.slice(0, 4).map((i) => (
              <a
                key={i.href}
                href={i.href}
                className="flex items-center justify-between gap-3 rounded-2xl bg-[#f7f9fb] px-4 py-3 ring-1 ring-black/5 hover:ring-[#8883d7]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{i.label}</span>
                  <span className="block truncate text-xs text-black/50">{i.detail}</span>
                </span>
                <span className="shrink-0 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-bold">★ Rate</span>
              </a>
            ))}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-bold text-black/50 hover:bg-black/5">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
