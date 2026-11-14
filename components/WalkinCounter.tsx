"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// Walk-in counter for the CRE. Each press is saved at once; when the internet drops, presses wait on the
// phone and are sent when it is back (each has its own id, so nothing is counted twice).
// In the Seven Years Care app (1.2+): volume up = +1, volume down = −1 while this screen is open.

type Pending = { id: string; delta: 1 | -1; source: string };
type Hour = { hour: number; count: number };

declare global {
  interface Window {
    __syWalkin?: (delta: number) => void;
  }
}

type AppBridge = { setWalkinCounter?: (on: boolean) => void; vibrate?: (ms: number) => void };
const app = () => (window as unknown as { SevenYearsApp?: AppBridge }).SevenYearsApp;

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;

export function WalkinCounter({
  store,
  stores,
  day,
  startCount,
  startHourly,
  bills,
}: {
  store: string;
  stores: string[];
  day: string;
  startCount: number;
  startHourly: Hour[];
  bills: number;
}) {
  const key = `sy-walkins-${store}-${day}`;
  const [server, setServer] = useState(startCount);
  const [pending, setPending] = useState<Pending[]>([]);
  const [hourly, setHourly] = useState<Hour[]>(startHourly);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const [volumeReady, setVolumeReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const sending = useRef(false);
  const queue = useRef<Pending[]>([]);

  const save = (list: Pending[]) => {
    queue.current = list;
    setPending(list);
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch {
      /* private mode */
    }
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/staff/performance/walkins?store=${encodeURIComponent(store)}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      if (!sending.current && queue.current.length === 0) setServer(d.count);
      setHourly(d.hourly ?? []);
    } catch {
      /* offline */
    }
  }, [store]);

  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const p = queue.current[0];
        const res = await fetch("/api/staff/performance/walkins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store, delta: p.delta, source: p.source, clientId: p.id }),
        });
        if (!res.ok) throw new Error("not saved");
        const d = await res.json();
        setServer(d.count);
        save(queue.current.slice(1));
      }
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      sending.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const press = useCallback(
    (delta: 1 | -1, source = "button") => {
      const total = server + queue.current.reduce((a, p) => a + p.delta, 0);
      if (delta === -1 && total <= 0) return;
      save([...queue.current, { id: newId(), delta, source }]);
      try {
        if (app()?.vibrate) app()!.vibrate!(delta === 1 ? 40 : 120);
        else navigator.vibrate?.(delta === 1 ? 40 : 120);
      } catch {
        /* no vibration */
      }
      setFlash(delta === 1 ? "up" : "down");
      window.setTimeout(() => setFlash(null), 250);
      void flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server, flush]
  );

  // Presses that were waiting on this phone (e.g. app closed while offline).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]") as Pending[];
      if (Array.isArray(saved) && saved.length) {
        save(saved);
        void flush();
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Volume buttons (Seven Years Care app), keep the screen on, and pick up other phones' presses.
  useEffect(() => {
    window.__syWalkin = (d: number) => press(d > 0 ? 1 : -1, "volume");
    return () => {
      delete window.__syWalkin;
    };
  }, [press]);

  useEffect(() => {
    const bridge = app();
    if (bridge?.setWalkinCounter) {
      bridge.setWalkinCounter(true);
      setVolumeReady(true);
    }
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => {
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (!bridge?.setWalkinCounter && nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {
        /* not supported */
      }
    };
    void wake();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void wake();
        void refresh();
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => {
      void refresh();
      if (queue.current.length) void flush();
    }, 20_000);
    return () => {
      bridge?.setWalkinCounter?.(false);
      void lock?.release().catch(() => null);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [refresh, flush]);

  const total = Math.max(0, server + pending.reduce((a, p) => a + p.delta, 0));
  const conv = total > 0 ? Math.round((bills / total) * 100) : null;
  const maxHour = Math.max(1, ...hourly.map((h) => h.count));

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Walk-in counter</p>
          <h1 className="text-2xl font-extrabold">{store}</h1>
        </div>
        {stores.length > 1 && (
          <div className="flex flex-wrap justify-end gap-1">
            {stores.map((s) => (
              <Link
                key={s}
                href={`/staff/walkins?store=${encodeURIComponent(s)}`}
                className={`rounded-full px-3 py-1 text-xs font-bold ${s === store ? "bg-[#8883d7] text-white" : "bg-white ring-1 ring-black/10"}`}
              >
                {s}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div
        className={`rounded-3xl bg-white p-6 text-center soft-card ring-1 transition ${
          flash === "up" ? "ring-4 ring-green-400" : flash === "down" ? "ring-4 ring-amber-400" : "ring-black/5"
        }`}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-black/45">Walk-ins today</p>
        <p className="mt-1 text-8xl font-extrabold tabular-nums leading-none">{total}</p>
        <p className="mt-3 text-sm text-black/55">
          {bills} bill(s) today · conversion <b className="text-black">{conv === null ? "—" : conv > 100 ? "check count" : `${conv}%`}</b>
        </p>
        {pending.length > 0 && (
          <p className={`mt-2 text-xs font-semibold ${offline ? "text-amber-700" : "text-black/45"}`}>
            {offline ? `No internet — ${pending.length} press(es) saved on this phone, will be sent automatically.` : "Saving…"}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => press(1)}
        className="flex w-full items-center justify-center gap-3 rounded-3xl bg-[#0b7f91] py-8 text-3xl font-extrabold text-white shadow-lg active:scale-[0.98]"
      >
        ＋1 Walk-in
      </button>
      <button
        type="button"
        onClick={() => press(-1)}
        disabled={total <= 0}
        className="w-full rounded-2xl bg-white py-3 text-base font-bold text-black/60 ring-1 ring-black/10 disabled:opacity-40"
      >
        −1 (undo a wrong press)
      </button>

      <div className={`rounded-2xl px-4 py-3 text-sm ${volumeReady ? "bg-green-50 text-green-800" : "bg-[#f7f9fb] text-black/60"}`}>
        {volumeReady ? (
          <>
            <b>Volume buttons are on:</b> volume up = +1, volume down = −1. Keep this screen open (it stays awake). A Bluetooth selfie remote works the same as volume up.
          </>
        ) : (
          <>
            Tip: in the <b>Seven Years Care app</b> (version 1.2 or newer) the phone’s <b>volume up</b> button adds a walk-in while this screen is open.
          </>
        )}
      </div>

      {hourly.length > 0 && (
        <div className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5">
          <p className="text-sm font-bold">Walk-ins by hour</p>
          <div className="mt-2 space-y-1">
            {hourly.map((h) => (
              <div key={h.hour} className="flex items-center gap-2 text-xs">
                <span className="w-12 shrink-0 text-black/50">{hourLabel(h.hour)}</span>
                <div className="h-3 flex-1 rounded bg-black/5">
                  <div className="h-3 rounded bg-[#8883d7]" style={{ width: `${(h.count / maxHour) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-bold tabular-nums">{h.count}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-black/40">Counted with the counter (totals typed in by hand have no time).</p>
        </div>
      )}
    </div>
  );
}
