"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const KINDS = [
  { key: "leave", label: "Approved leave" },
  { key: "week_off", label: "Weekly off" },
  { key: "official", label: "Official work / training" },
  { key: "missed_punch", label: "Was present — punch missed" },
  { key: "other", label: "Other (write the reason)" },
];

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/performance/duties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Could not save.");
}

/** HR / Store Manager: mark an absent day as justified (it then counts as a duty). */
export function JustifyDay({ userId, day }: { userId: string; day: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("leave");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#5b55c9] ring-1 ring-[#8883d7]/40 hover:bg-[#8883d7]/10">
        Justify
      </button>
    );
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-white p-2.5 ring-1 ring-black/10">
      <select className="w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
        {KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
      <input className="w-full rounded-lg border border-black/10 px-2 py-1.5 text-sm" placeholder={kind === "other" ? "Reason (needed)" : "Note (optional)"} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await post({ action: "justify", userId, day, kind, reason });
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save.");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-full bg-[#8883d7] px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-full bg-white px-3 py-1 text-xs font-bold ring-1 ring-black/10">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function RemoveJustification({ userId, day }: { userId: string; day: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirm("Remove this justification? The day will count as absent again.")) return;
        setBusy(true);
        try {
          await post({ action: "remove", userId, day });
          router.refresh();
        } catch (e) {
          alert(e instanceof Error ? e.message : "Could not remove.");
        } finally {
          setBusy(false);
        }
      }}
      className="text-[11px] font-semibold text-red-700 hover:underline disabled:opacity-50"
    >
      Remove
    </button>
  );
}
