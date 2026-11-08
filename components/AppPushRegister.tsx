"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    SevenYearsApp?: { pushToken?: () => string };
  }
}

/** Inside the mobile app: send this phone's notification token to the server (once per page load). */
export function AppPushRegister() {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const token = window.SevenYearsApp?.pushToken?.();
        if (!token) return;
        fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, platform: "android" }),
        }).catch(() => {});
      } catch {
        /* not in the app */
      }
    }, 2000);
    return () => clearTimeout(t);
  }, []);
  return null;
}
