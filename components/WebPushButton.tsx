"use client";

import { useEffect, useState } from "react";

// Firebase loaded from Google's CDN only when needed (keeps the site light).
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = new Function("u", "return import(u)") as (u: string) => Promise<any>;

async function registerWebPush() {
  const res = await fetch("/api/push/web-config");
  if (!res.ok) return false;
  const { config } = await res.json();
  const [{ initializeApp, getApps }, { getMessaging, getToken }] = await Promise.all([
    load(`${SDK}/firebase-app.js`),
    load(`${SDK}/firebase-messaging.js`),
  ]);
  const app = getApps().find((a: { name: string }) => a.name === "sy-web") ?? initializeApp(config, "sy-web");
  const registration = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
  const token = await getToken(getMessaging(app), { serviceWorkerRegistration: registration });
  if (!token) return false;
  await fetch("/api/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform: "web" }),
  });
  return true;
}

function supported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Website / home-screen app: lets the person switch on notifications (offers, wishes, request updates).
 * Hidden inside the Android app (it has its own) and when already switched on.
 */
export function WebPushButton({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"hidden" | "ask" | "busy" | "done" | "error">("hidden");

  useEffect(() => {
    if (!supported() || (window as { SevenYearsApp?: unknown }).SevenYearsApp) return;
    if (Notification.permission === "granted") {
      // Keep this browser's token fresh, once per visit.
      try {
        if (sessionStorage.getItem("sy-webpush")) return;
        sessionStorage.setItem("sy-webpush", "1");
      } catch {}
      registerWebPush().catch(() => {});
      return;
    }
    if (Notification.permission === "default") setState("ask");
  }, []);

  if (state === "hidden") return null;
  if (state === "done") return compact ? null : <p className="text-sm font-semibold text-green-700">🔔 Notifications are on.</p>;

  const turnOn = async () => {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState("hidden");
      setState((await registerWebPush()) ? "done" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#8883d7]/10 px-4 py-3 ring-1 ring-[#8883d7]/20">
      <span className="text-sm font-semibold">🔔 Get offers, birthday wishes and request updates as notifications</span>
      <button
        type="button"
        onClick={turnOn}
        disabled={state === "busy"}
        className="rounded-xl bg-[#8883d7] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {state === "busy" ? "Turning on…" : "Turn on"}
      </button>
      {state === "error" && <span className="text-xs text-red-700">Could not turn on here. Try again later.</span>}
    </div>
  );
}
