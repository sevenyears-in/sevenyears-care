"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type CamPhotoView = { id: number; at: string; offsetSec: number; camera: string; url: string };
type Check = { verdict: "ok" | "proxy"; by: string | null; note: string | null } | null;

const offset = (s: number) => (s === 0 ? "at the punch" : `${Math.abs(s) >= 60 ? `${Math.floor(Math.abs(s) / 60)}m ${Math.abs(s) % 60}s` : `${Math.abs(s)}s`} ${s < 0 ? "before" : "after"}`);

/**
 * CCTV photos at the opener's (closer's) own punch, and the Director's check:
 * "It's them" or "Someone else punched" (proxy punch).
 */
export function CamCheck({
  day,
  store,
  kind,
  name,
  photos,
  check,
  canCheck,
  missing,
}: {
  day: string;
  store: string;
  kind: "open" | "close";
  name: string;
  photos: CamPhotoView[];
  check: Check;
  canCheck: boolean;
  /** The store has CCTV, but no photo arrived near the punch. */
  missing: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (verdict: "ok" | "proxy" | null) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/staff/performance/open-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cam", day, store, kind, verdict, note }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Could not save.");
    setAsking(false);
    setNote("");
    router.refresh();
  };

  return (
    <div className="mt-2 space-y-1.5">
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="group block w-28" title={`${p.camera} · ${offset(p.offsetSec)} ${name}'s punch`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Camera photo ${offset(p.offsetSec)} the punch`} loading="lazy" className="h-[4.5rem] w-28 rounded-lg object-cover ring-1 ring-black/10 group-hover:ring-[#8883d7]" />
              <span className="block truncate text-[10px] text-black/50">{offset(p.offsetSec)}</span>
            </a>
          ))}
        </div>
      )}

      {check?.verdict === "ok" && (
        <p className="text-[11px] font-semibold text-green-700">
          📷 Camera: it&apos;s {name} ✓{check.by ? <span className="font-normal text-black/50"> · checked by {check.by}</span> : null}
        </p>
      )}
      {check?.verdict === "proxy" && (
        <p className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-800">
          Proxy punch — someone else punched for {name}
        </p>
      )}
      {check?.verdict === "proxy" && (check.by || check.note) && (
        <p className="text-[11px] text-black/55">
          {check.by ? `Marked by ${check.by}` : ""}
          {check.note ? ` — ${check.note}` : ""}
        </p>
      )}

      {canCheck && (photos.length > 0 || check) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!check && !asking && (
            <>
              <button type="button" disabled={busy} onClick={() => save("ok")} className="rounded-full bg-green-700 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                It&apos;s {name.split(" ")[0]}
              </button>
              <button type="button" disabled={busy} onClick={() => setAsking(true)} className="rounded-full bg-red-700 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                Someone else
              </button>
            </>
          )}
          {asking && (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                placeholder="Who is in the photo? (optional)"
                className="min-w-[12rem] flex-1 rounded-xl border border-black/10 px-3 py-1.5 text-xs"
              />
              <button type="button" disabled={busy} onClick={() => save("proxy")} className="rounded-full bg-red-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">
                Mark proxy punch
              </button>
              <button type="button" onClick={() => setAsking(false)} className="text-xs font-semibold text-black/50">
                Cancel
              </button>
            </>
          )}
          {check && (
            <button type="button" disabled={busy} onClick={() => save(null)} className="text-[11px] font-semibold text-black/45 underline">
              Undo check
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
