"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function QuoteDecision({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "approve" | "decline">("");
  const [error, setError] = useState("");

  const decide = async (decision: "approve" | "decline") => {
    if (decision === "decline" && !window.confirm("Decline this repair quote?")) return;
    setBusy(decision);
    setError("");
    const res = await fetch("/api/service-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, decision }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy("");
    if (res?.ok || res?.status === 409) router.refresh();
    else setError(data.error ?? "Unable to save. Please try again.");
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={Boolean(busy)}
          className="rounded-2xl bg-green-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy === "approve" ? "Saving…" : "✓ Approve repair"}
        </button>
        <button
          type="button"
          onClick={() => decide("decline")}
          disabled={Boolean(busy)}
          className="rounded-2xl px-5 py-3 text-sm font-bold ring-1 ring-black/15 disabled:opacity-50"
        >
          {busy === "decline" ? "Saving…" : "Decline"}
        </button>
      </div>
      {error && <p className="text-sm text-[#d43852]">{error}</p>}
    </div>
  );
}
