"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the app's service worker (once, on every staff page). */
export function AppSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => null);
    }
  }, []);
  return null;
}

/** "Install the app" card for the staff dashboard (hidden once installed). */
export function InstallAppCard() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ua = navigator.userAgent.toLowerCase();
    const detected = /iphone|ipad|ipod/.test(ua) || (ua.includes("mac") && navigator.maxTouchPoints > 1)
      ? "ios"
      : ua.includes("android")
        ? "android"
        : "desktop";
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("sy_install_hidden") === "1";
    } catch {
      dismissed = false;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const apply = () => {
      setInstalled(standalone);
      setPlatform(detected);
      setHidden(dismissed);
    };
    apply();

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || hidden) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem("sy_install_hidden", "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-[#8883d7] p-5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/app-icon-192.png" alt="" className="h-12 w-12 rounded-2xl bg-white" />
        <div>
          <p className="font-bold">Get the Seven Years Care app</p>
          <p className="text-sm text-white/85">
            {platform === "ios"
              ? "On iPhone: open this page in Safari, tap the Share button (square with arrow), then “Add to Home Screen”."
              : installEvent
                ? "Install it on this device — opens full screen, straight from your home screen."
                : platform === "android"
                  ? "On Android: tap the ⋮ menu in Chrome, then “Install app” or “Add to Home screen”."
                  : "Open care.sevenyears.in/staff on your phone to install it there."}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        {installEvent && (
          <button
            type="button"
            onClick={async () => {
              await installEvent.prompt();
              const choice = await installEvent.userChoice.catch(() => null);
              if (choice?.outcome === "accepted") setInstalled(true);
              setInstallEvent(null);
            }}
            className="rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-[#161616]"
          >
            Install app
          </button>
        )}
        <button type="button" onClick={hide} className="rounded-2xl border border-white/40 px-4 py-2.5 text-sm font-bold">
          Not now
        </button>
      </div>
    </div>
  );
}
