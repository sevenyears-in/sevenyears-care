"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Super Admin: switch the normal warranty between 3 months and the usual period. */
export function SetNormalMonths({ id, months, usual, short }: { id: string; months: number; usual: number; short: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const target = months === short ? usual : short;

  const save = async () => {
    if (target === short && reason.trim().length < 5) return setError("Write the reason.");
    if (!confirm(`Change the normal warranty to ${target} months? The certificate and “covered until” date change straight away${target === usual ? "" : " (extended warranty, if bought, moves with it)"}.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/staff/warranties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "normal_months", months: target, reason: reason.trim() }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Unable to save.");
    setAsking(false);
    router.refresh();
  };

  if (usual <= short) return null;
  return (
    <div className="mt-3">
      {target === short && !asking ? (
        <button type="button" onClick={() => setAsking(true)} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-bold hover:bg-black/5">
          Change to {short} months
        </button>
      ) : target === short ? (
        <div className="space-y-2">
          <input
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Reason for ${short}-month warranty`}
            className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={save} className="rounded-xl bg-[#161616] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-xl px-3 py-2 text-xs font-bold text-black/55">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={save} className="rounded-xl bg-[#0b7f91] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          Change to {usual} months
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
