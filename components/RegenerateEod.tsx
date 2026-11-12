"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Super Admin: make a store's end-of-day report again (e.g. after a late copy from Zoho). */
export function RegenerateEod({ stores, today }: { stores: string[]; today: string }) {
  const router = useRouter();
  const [store, setStore] = useState(stores[0] ?? "");
  const [day, setDay] = useState(today);
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function go() {
    if (email && !window.confirm(`Make the ${store} report for ${day} again and e-mail it to the store manager and management?`)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/staff/admin/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "eod_regenerate", store, day, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not make the report.");
      setMsg(`Done: ${data.status}${email ? `, e-mailed to ${data.emailed}` : ""}.`);
      router.push(`/staff/performance/reports?day=${day}&store=${encodeURIComponent(store)}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not make the report.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 text-sm soft-card ring-1 ring-black/5">
      <span className="font-semibold">Make a report (again):</span>
      <select value={store} onChange={(e) => setStore(e.target.value)} className="rounded-xl border border-black/10 px-2 py-1.5">
        {stores.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className="rounded-xl border border-black/10 px-2 py-1.5" />
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> e-mail it
      </label>
      <button type="button" onClick={go} disabled={busy || !store} className="rounded-full bg-[#8883d7] px-4 py-1.5 font-semibold text-white disabled:opacity-50">
        {busy ? "Making…" : "Make report"}
      </button>
      {msg && <span className="text-xs text-black/60">{msg}</span>}
    </div>
  );
}
