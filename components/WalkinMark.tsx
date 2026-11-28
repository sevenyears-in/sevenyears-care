"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/performance/walkin-mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Could not save.");
  return d as { photos?: number };
}

/** On a walk-in photo: "Not a walk-in" / "This is a customer", with a short note; the AI learns from it. */
export function WalkinMark({
  id,
  counted,
  mark,
}: {
  id: number;
  /** Is the photo counted as a customer now (by the AI)? */
  counted: boolean;
  mark: { verdict: "staff" | "customer"; note: string | null; by: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"staff" | "customer" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await post(body);
      setOpen(null);
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (mark) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 px-3 py-2 text-[11px]">
        <p className={`font-bold ${mark.verdict === "staff" ? "text-black/70" : "text-green-700"}`}>
          ✓ Marked: {mark.verdict === "staff" ? "not a walk-in" : "customer"}
          {mark.note ? ` · ${mark.note}` : ""}
          <span className="font-normal text-black/45">{mark.by ? ` · by ${mark.by}` : ""} · the AI learns from this</span>
        </p>
        <button type="button" disabled={busy} onClick={() => run({ action: "unmark", id })} className="font-semibold text-black/50 hover:underline disabled:opacity-50">
          Undo
        </button>
        {error && <p className="w-full text-red-700">{error}</p>}
      </div>
    );
  }

  const verdict: "staff" | "customer" = counted ? "staff" : "customer";
  return (
    <div className="border-t border-black/5 px-3 py-2 text-[11px]">
      {open ? (
        <div className="space-y-1.5">
          <p className="font-semibold">{open === "staff" ? "Not a walk-in" : "This is a customer coming in"}</p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder={open === "staff" ? "Why? e.g. staff in black uniform, HK staff, mannequin (optional)" : "e.g. lady in black burqa with child (optional)"}
            className="w-full rounded-lg border border-black/15 px-2 py-1.5 text-xs"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => run({ action: "mark", id, verdict: open, note })} className="rounded-full bg-[#8883d7] px-3 py-1 font-bold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={() => setOpen(null)} className="rounded-full px-3 py-1 font-semibold ring-1 ring-black/10">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(verdict)}
          className={`rounded-full px-3 py-1 font-bold ring-1 ${verdict === "staff" ? "text-red-700 ring-red-200 hover:bg-red-50" : "text-green-700 ring-green-200 hover:bg-green-50"}`}
        >
          {verdict === "staff" ? "✗ Not a walk-in" : "✓ This is a customer"}
        </button>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}

/** Check today's photos of the store again with what the AI has learned. */
export function RecheckButton({ store }: { store: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg("");
          try {
            const d = await post({ action: "recheck", store });
            setMsg(`${d.photos ?? 0} photo(s) will be checked again in the next few minutes.`);
            router.refresh();
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "Could not start.");
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-full bg-white px-4 py-1.5 text-sm font-bold ring-1 ring-black/10 hover:bg-black/5 disabled:opacity-50"
      >
        {busy ? "Starting…" : "↻ Check today's photos again with what it learned"}
      </button>
      {msg && <span className="text-xs text-black/60">{msg}</span>}
    </span>
  );
}
