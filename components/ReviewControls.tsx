"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "publish" | "unpublish" | "approve" | "reject" | "regenerate";

/** Publish / Unpublish / Reject / Regenerate for one feedback summary. */
export function ReviewControls({ id, status, eligible, canManage }: { id: string; status: string; eligible: boolean; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");

  const run = async (action: Action) => {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/staff/feedback/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Could not update.");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const btn = "rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManage && eligible && status !== "published" && (
        <button type="button" disabled={!!busy} onClick={() => run("publish")} className={`${btn} bg-green-600 text-white`}>
          {busy === "publish" ? "…" : "Publish"}
        </button>
      )}
      {canManage && status === "published" && (
        <button type="button" disabled={!!busy} onClick={() => run("unpublish")} className={`${btn} bg-[#161616] text-white`}>
          {busy === "unpublish" ? "…" : "Unpublish"}
        </button>
      )}
      {canManage && eligible && !["rejected", "published"].includes(status) && (
        <button type="button" disabled={!!busy} onClick={() => run("reject")} className={`${btn} bg-white text-[#d43852] ring-1 ring-[#d43852]/30`}>
          {busy === "reject" ? "…" : "Reject"}
        </button>
      )}
      {canManage && (
        <button type="button" disabled={!!busy} onClick={() => run("regenerate")} className={`${btn} bg-white text-black/60 ring-1 ring-black/10`}>
          {busy === "regenerate" ? "…" : "Regenerate summary"}
        </button>
      )}
      {error && <span className="text-xs font-semibold text-red-700">{error}</span>}
    </div>
  );
}
