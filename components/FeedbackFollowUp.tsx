"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function FeedbackFollowUp({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl bg-[#161616] px-3 py-2 text-xs font-bold text-white"
      >
        Mark followed up
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2">
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was done? (e.g. called the customer, technician visited)"
        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            const res = await fetch("/api/staff/feedback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, note }),
            }).catch(() => null);
            setBusy(false);
            if (!res?.ok) {
              setError("Unable to save. Try again.");
              return;
            }
            router.refresh();
          }}
          className="rounded-xl bg-[#ff5e79] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold">
          Cancel
        </button>
      </div>
    </div>
  );
}
