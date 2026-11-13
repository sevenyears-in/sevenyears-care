"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseReport, reportSummary } from "@/lib/report-parse";
import { registerWebPush, supported } from "@/components/WebPushButton";

/** Short text for pop-ups and phone notifications (reports become one line per store). */
function shortBody(body: string | null) {
  const segs = parseReport(body);
  return segs ? reportSummary(segs) : (body ?? "");
}

// Live in-app alerts: checks for new alerts every 30 seconds, plays a chime,
// shows a pop-up and (when allowed) a phone / desktop notification.

type LiveAlert = {
  id: string;
  ticket_type: string | null;
  ticket_id: string | null;
  title: string;
  body: string | null;
  created_at: string;
};

const EVENT = "sy-alerts-count";
const POLL_MS = 30_000;

function alertHref(a: LiveAlert) {
  if (/explanation is needed/i.test(a.title)) return "/staff/explanations";
  if (/extended warranty/i.test(a.title)) return "/staff/extended-warranty";
  if (/^(TEST · )?(Updated: )?End of day /.test(a.title)) return "/staff/performance/reports";
  const stockStore = /^(?:TEST · )?([A-Z][A-Z ]+) stock alert$/.exec(a.title);
  if (stockStore) return `/staff/performance/stock?store=${encodeURIComponent(stockStore[1])}`;
  if (/^(TEST · )?(Sales update|Your sales|[A-Z][A-Z ]+ sales) \d/.test(a.title)) return "/staff/performance";
  if (a.ticket_id) return `/staff/${a.ticket_type === "service" ? "service" : "complaints"}/${a.ticket_id}`;
  return /feedback/i.test(a.title) ? "/staff/feedback" : "/staff/alerts";
}

// Alert sound is always on in the app (to silence or change it, staff use the phone's own settings).

let audioCtx: AudioContext | null = null;
function getAudio() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  return audioCtx;
}

/** Two-note chime made in the browser (no sound file needed). */
export function playChime() {
  const ctx = getAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => null);
  const now = ctx.currentTime;
  [880, 1318.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  });
}

/** Unread count that stays in sync with the live checker (header bell, bottom menu). */
export function useUnreadCount(initial: number) {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const on = (e: Event) => setCount((e as CustomEvent<number>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return count;
}

export function LiveAlerts() {
  const router = useRouter();
  const since = useRef<string>(new Date().toISOString());
  const lastCount = useRef<number | null>(null);
  const [toasts, setToasts] = useState<LiveAlert[]>([]);

  // Browsers only allow sound (and asking for notifications) after the person has tapped the page once.
  // Notifications are kept on: on the first tap the browser is asked to allow them, with no menu or switch.
  // In the Seven Years Care app the phone asks by itself when the app opens.
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudio();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => null);
      try {
        if (!window.SevenYearsApp && "Notification" in window && Notification.permission === "default") {
          Notification.requestPermission()
            .then((p) => (p === "granted" && supported() ? registerWebPush() : null))
            .catch(() => null);
        }
      } catch {
        /* not supported */
      }
    };
    // Already allowed: keep this browser signed up for phone notifications (once per visit).
    try {
      if (!window.SevenYearsApp && supported() && Notification.permission === "granted" && !sessionStorage.getItem("sy-webpush")) {
        sessionStorage.setItem("sy-webpush", "1");
        registerWebPush().catch(() => null);
      }
    } catch {
      /* ignore */
    }
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const check = useCallback(async () => {
    if (document.visibilityState === "hidden" && !("Notification" in window && Notification.permission === "granted")) {
      return;
    }
    try {
      const res = await fetch(`/api/staff/alerts?since=${encodeURIComponent(since.current)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; latest: LiveAlert[]; now: string };
      since.current = data.now || new Date().toISOString();
      window.dispatchEvent(new CustomEvent(EVENT, { detail: data.unread }));

      const fresh = data.latest ?? [];
      if (fresh.length > 0) {
        playChime();
        setToasts((t) => [...fresh, ...t].slice(0, 3));
        if ("vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
        await showSystemNotification(fresh[0], fresh.length);
        router.refresh();
      } else if (lastCount.current !== null && data.unread !== lastCount.current) {
        router.refresh();
      }
      lastCount.current = data.unread;
    } catch {
      // offline — try again next time
    }
  }, [router]);

  useEffect(() => {
    const first = setTimeout(check, 4000);
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    const onDemand = () => check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("sy-alerts-check", onDemand);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("sy-alerts-check", onDemand);
    };
  }, [check]);

  // Pop-ups disappear after 12 seconds.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((list) => list.slice(0, -1)), 12_000);
    return () => clearTimeout(t);
  }, [toasts]);

  if (toasts.length === 0) return null;
  return (
    <div className="no-print fixed inset-x-3 top-3 z-50 space-y-2 sm:left-auto sm:right-4 sm:top-4 sm:w-96" aria-live="polite">
      {toasts.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-2xl bg-[#161616] p-4 text-white shadow-xl">
          <span className="text-xl" aria-hidden>
            🔔
          </span>
          <Link
            href={alertHref(a)}
            onClick={() => {
              setToasts((t) => t.filter((x) => x.id !== a.id));
              fetch("/api/staff/alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: a.id }),
                keepalive: true,
              }).catch(() => null);
            }}
            className="min-w-0 flex-1"
          >
            <p className="text-sm font-bold">{a.title}</p>
            {a.body && <p className="mt-0.5 line-clamp-2 text-xs text-white/70">{shortBody(a.body)}</p>}
          </Link>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToasts((t) => t.filter((x) => x.id !== a.id))}
            className="text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

async function showSystemNotification(a: LiveAlert, total: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible" && document.hasFocus()) return; // the pop-up is enough
  const title = total > 1 ? `${total} new alerts` : a.title;
  const options: NotificationOptions = {
    body: shortBody(a.body),
    icon: "/app-icon-192.png",
    badge: "/app-icon-192.png",
    tag: a.id,
    data: { url: alertHref(a) },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // ignore
  }
}

declare global {
  interface Window {
    SevenYearsApp?: { pushToken?: () => string; openNotificationSound?: () => void };
  }
}
