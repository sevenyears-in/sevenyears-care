"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Today's walk-ins (running total) — posted by the CRE, shown with conversion = bills ÷ walk-ins. */
export function WalkinBox({
  store,
  bills,
  count,
  updatedBy,
  updatedAt,
  canEdit,
}: {
  store: string;
  bills: number;
  count: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(count === null ? "" : String(count));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Number(value);
  const tooFew = value !== "" && Number.isInteger(n) && n < bills;
  const conv = count && count > 0 ? Math.round((bills / count) * 100) : null;
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : null;

  async function save() {
    if (!Number.isInteger(n) || n < 0) return setError("Enter a whole number.");
    if (tooFew && !window.confirm(`Walk-ins (${n}) are fewer than today's bills (${bills}). Save anyway?`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/staff/performance/walkins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store, count: n }) });
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

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl bg-white px-5 py-4 soft-card ring-1 ring-black/5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Walk-ins today · {store}</p>
        <p className="text-2xl font-bold tabular-nums">{count ?? "—"}</p>
        <p className="text-xs text-black/50">{count === null ? "Not posted yet — the CRE posts the total so far, before each update (11, 2, 5, 8)." : `Posted by ${updatedBy ?? "—"} at ${time}`}</p>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-black/45">Conversion</p>
        <p className="text-2xl font-bold tabular-nums">{conv === null ? "—" : `${conv}%`}</p>
        <p className="text-xs text-black/50">{bills} bill(s) ÷ walk-ins</p>
      </div>
      {canEdit && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className="w-28 rounded-xl border border-black/10 px-3 py-2 text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Walk-ins"
                autoFocus
              />
              <button type="button" onClick={save} disabled={busy || value === ""} className="rounded-full bg-[#8883d7] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(false)} disabled={busy} className="rounded-full px-3 py-2 text-sm font-semibold ring-1 ring-black/10">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="rounded-full bg-[#0b7f91] px-4 py-2 text-sm font-semibold text-white">
              {count === null ? "Post walk-ins" : "Update walk-ins"}
            </button>
          )}
          {tooFew && editing && <p className="w-full text-xs text-amber-700">Fewer than today’s {bills} bill(s) — check the count.</p>}
          {error && <p className="w-full text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
