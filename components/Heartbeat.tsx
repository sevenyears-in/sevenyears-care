"use client";

import { useEffect } from "react";

const PAGES = /^\/(staff|account|my-warranties|offers|app|warranty|track-request)(\/|$)/;

/** While a logged-in page is open and on screen, tell the server once a minute (for "Online now"). */
export function Heartbeat() {
  useEffect(() => {
    const beat = () => {
      const path = window.location.pathname;
      if (!PAGES.test(path) || path.startsWith("/staff/login")) return;
      if (document.visibilityState === "visible") fetch("/api/ping", { method: "POST", keepalive: true }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return null;
}
