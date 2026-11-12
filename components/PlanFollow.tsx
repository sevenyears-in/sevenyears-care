"use client";

// Follow-up of one action plan point: View → Update → choose → Save / Cancel.

import { useState } from "react";
import { useRouter } from "next/navigation";

const LABEL: Record<string, { text: string; cls: string }> = {
  open: { text: "Open", cls: "bg-black/5 text-black/60" },
  in_progress: { text: "In progress", cls: "bg-amber-100 text-amber-800" },
  done: { text: "Done", cls: "bg-green-100 text-green-800" },
  not_relevant: { text: "Not relevant", cls: "bg-black/5 text-black/40" },
};

export function PlanFollow({
  store,
  month,
  role,
  pkey,
  title,
  status,
  note,
  by,
  at,
  canEdit,
}: {
  store: string;
  month: string;
  role: string;
  pkey: string;
  title: string;
  status: string;
  note: string | null;
  by: string | null;
  at: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [s, setS] = useState(status);
  const [n, setN] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staff/performance/plan-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store, month, role, key: pkey, title, status: s, note: n }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not save.");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  const l = LABEL[status] ?? LABEL.open;
  if (!editing)
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-bold ${l.cls}`}>{l.text}</span>
        {note && <span className="text-black/55">“{note}”</span>}
        {by && at && <span className="text-black/40">{by} · {new Date(at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>}
        {canEdit && (
          <button className="font-semibold text-[#5b55c9]" onClick={() => setEditing(true)}>
            Update
          </button>
        )}
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select className="rounded-lg border border-black/10 bg-white px-2 py-1" value={s} onChange={(e) => setS(e.target.value)}>
        {Object.entries(LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v.text}
          </option>
        ))}
      </select>
      <input className="w-56 rounded-lg border border-black/10 bg-white px-2 py-1" placeholder="Note (optional)" maxLength={300} value={n} onChange={(e) => setN(e.target.value)} />
      <button className="rounded-full bg-[#8883d7] px-3 py-1 font-semibold text-white disabled:opacity-50" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button className="rounded-full px-3 py-1 font-semibold ring-1 ring-black/10" disabled={busy} onClick={() => setEditing(false)}>
        Cancel
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}
