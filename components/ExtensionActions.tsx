"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExtensionActions({ id, status, priceLabel }: { id: string; status: string; priceLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"approve" | "reject" | "paid_store" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!open) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/staff/extended-warranty", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: open, note }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(data.error || "Unable to save.");
      return;
    }
    setOpen(null);
    setNote("");
    router.refresh();
  };

  const btn = "rounded-xl px-3 py-2 text-xs font-bold";
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "pending_inspection" && (
          <>
            <button type="button" onClick={() => setOpen("approve")} className={`${btn} bg-green-600 text-white`}>
              ✓ Passed inspection
            </button>
            <button type="button" onClick={() => setOpen("reject")} className={`${btn} border border-black/10 bg-white text-red-700`}>
              ✕ Can&apos;t be covered
            </button>
          </>
        )}
        {status === "awaiting_payment" && (
          <button type="button" onClick={() => setOpen("paid_store")} className={`${btn} bg-[#161616] text-white`}>
            Paid {priceLabel} at the store
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 rounded-2xl bg-[#f7f9fb] p-3">
          <p className="text-xs font-semibold text-black/60">
            {open === "approve"
              ? "The customer gets a WhatsApp message with the payment link."
              : open === "reject"
                ? "Write why it can't be covered — the customer sees this."
                : `Confirm the customer paid ${priceLabel} at the store. The warranty is extended immediately.`}
          </p>
          {open !== "paid_store" && (
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
              placeholder={open === "approve" ? "Inspection notes (optional)" : "Reason *"}
            />
          )}
          {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={send} className={`${btn} bg-[#ff5e79] text-white disabled:opacity-50`}>
              {busy ? "Saving…" : "Confirm"}
            </button>
            <button type="button" onClick={() => setOpen(null)} className={`${btn} border border-black/10 bg-white`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
