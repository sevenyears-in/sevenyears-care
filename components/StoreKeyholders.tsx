"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorBox, inputClass } from "@/components/SiteChrome";
import { formatDate } from "@/lib/helpers";

type KeyHolder = { id: string; store: string; code: string; name: string; kinds: ("open" | "close")[]; from: string | null; to: string | null; note: string; by: string; at: string };
type StaffOption = { code: string; name: string; store: string | null };

const card = "rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5";
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Settings → Attendance (Super Admin): who else may open / close each store, ongoing or for set dates. */
export default function StoreKeyholders() {
  const [list, setList] = useState<KeyHolder[] | null>(null);
  const [stores, setStores] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ store: "", code: "", open: true, close: true, dated: false, from: today(), to: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/staff/admin/keyholders", { cache: "no-store" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return setError(data.error ?? "Could not load.");
    setList(data.list ?? []);
    setStores(data.stores ?? []);
    setStaff(data.staff ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/staff/admin/keyholders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(data.error ?? "Could not save.");
      return false;
    }
    await load();
    return true;
  };

  const add = async () => {
    const ok = await post({
      action: "add",
      store: form.store,
      code: form.code,
      kinds: [form.open && "open", form.close && "close"].filter(Boolean),
      from: form.dated ? form.from : null,
      to: form.dated ? form.to : null,
      note: form.note,
    });
    if (ok) {
      setAdding(false);
      setForm({ ...form, code: "", note: "" });
    }
  };

  // Staff of the chosen store first.
  const people = useMemo(
    () => [...staff].sort((a, b) => Number(b.store?.toUpperCase() === form.store) - Number(a.store?.toUpperCase() === form.store) || a.name.localeCompare(b.name)),
    [staff, form.store]
  );
  const t = today();
  const state = (k: KeyHolder) => (k.to && k.to < t ? "ended" : k.from && k.from > t ? "coming" : "active");
  const shown = (list ?? []).filter((k) => state(k) !== "ended");
  const ended = (list ?? []).filter((k) => state(k) === "ended");

  return (
    <div className={card}>
      <h2 className="text-lg font-bold">Who else may open &amp; close a store</h2>
      <p className="mt-1 max-w-3xl text-sm text-black/60">
        By the SOP the Store Manager or the ASM / Floor Manager opens and closes. Allow someone else here, ongoing or for set dates (e.g. while
        the SM is on leave): their openings and closings then follow the SOP, without the Director approving each one. Days already marked as a
        violation by them in those dates are corrected too.
      </p>

      {list && (
        <div className="mt-4 overflow-x-auto">
          {shown.length === 0 ? (
            <p className="text-sm text-black/50">Nobody else yet: only the SM and ASM / FM.</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-black/45">
                  <th className="py-2 pr-3">Store</th>
                  <th className="py-2 pr-3">Person</th>
                  <th className="py-2 pr-3">May</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((k) => (
                  <tr key={k.id} className="border-t border-black/5">
                    <td className="py-2 pr-3 font-semibold">{k.store}</td>
                    <td className="py-2 pr-3">
                      {k.name} <span className="text-xs text-black/40">{k.code}</span>
                    </td>
                    <td className="py-2 pr-3">{k.kinds.length === 2 ? "Open & close" : k.kinds[0] === "open" ? "Open" : "Close"}</td>
                    <td className="py-2 pr-3">
                      {!k.from && !k.to ? "Ongoing" : `${k.from ? formatDate(k.from) : "…"} – ${k.to ? formatDate(k.to) : "no end"}`}
                      {state(k) === "coming" && <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">Starts later</span>}
                    </td>
                    <td className="py-2 pr-3 text-black/60">
                      {k.note || "—"}
                      <span className="block text-[11px] text-black/40">by {k.by}</span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => confirm(`Stop allowing ${k.name} to ${k.kinds.join(" / ")} ${k.store}?`) && void post({ action: "remove", id: k.id })}
                        className="text-xs font-semibold text-red-700 underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {ended.length > 0 && <p className="mt-2 text-xs text-black/45">{ended.length} permission(s) have ended.</p>}
        </div>
      )}

      {list && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="mt-4 rounded-xl border border-black/15 px-4 py-2 text-sm font-bold">
          + Allow someone
        </button>
      )}
      {adding && (
        <div className="mt-4 space-y-3 rounded-2xl bg-black/[0.02] p-4 ring-1 ring-black/5">
          <div className="flex flex-wrap gap-2">
            <select className={`${inputClass} w-48`} value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })}>
              <option value="">Store…</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select className={`${inputClass} w-72`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
              <option value="">Person…</option>
              {people.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} ({p.code}){p.store ? ` · ${p.store}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.open} onChange={(e) => setForm({ ...form, open: e.target.checked })} /> May open
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.close} onChange={(e) => setForm({ ...form, close: e.target.checked })} /> May close
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!form.dated} onChange={() => setForm({ ...form, dated: false })} /> Ongoing
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={form.dated} onChange={() => setForm({ ...form, dated: true })} /> For set dates
            </label>
            {form.dated && (
              <span className="flex flex-wrap items-center gap-2">
                <input type="date" className={`${inputClass} w-40`} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
                to
                <input type="date" className={`${inputClass} w-40`} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </span>
            )}
          </div>
          <input className={inputClass} maxLength={200} placeholder="Reason (e.g. SM on leave 1–5 Dec)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !form.store || !form.code || (!form.open && !form.close) || (form.dated && (!form.from || !form.to))}
              onClick={add}
              className="rounded-xl bg-[#161616] px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}
      <ErrorBox message={error} />
    </div>
  );
}
