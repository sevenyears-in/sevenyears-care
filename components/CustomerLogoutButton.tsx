"use client";

import { useState } from "react";
import { afterLogout } from "@/lib/in-app";

export function CustomerLogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/account/logout", { method: "POST" }).catch(() => null);
        window.location.assign(afterLogout("/account/login"));
      }}
      className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-bold text-black/60 disabled:opacity-50"
    >
      {busy ? "..." : "Log out"}
    </button>
  );
}
