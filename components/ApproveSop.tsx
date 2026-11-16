"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Director: approve an opening / closing that did not follow the SOP, with a reason. */
export function ApproveSop({ day, store, kind }: { day: string; store: string; kind: "open" | "close" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/staff/performance/open-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, store, kind, note }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Could not save.");
    setOpen(false);
    router.refresh();
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-[#161616] px-3 py-1 text-xs font-bold text-white">
        Approve
      </button>
    );
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
        placeholder="Reason (e.g. SM on leave, approved)"
        className="min-w-[14rem] flex-1 rounded-xl border border-black/10 px-3 py-1.5 text-xs"
      />
      <button type="button" disabled={busy} onClick={save} className="rounded-full bg-[#0b7f91] px-3 py-1 text-xs font-bold text-white disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-black/50">
        Cancel
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
