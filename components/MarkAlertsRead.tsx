"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAlertsRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/staff/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
        setBusy(false);
        router.refresh();
      }}
      className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-bold transition hover:bg-black hover:text-white disabled:opacity-50"
    >
      {busy ? "..." : "Mark all as read"}
    </button>
  );
}
