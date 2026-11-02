"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/helpers";

type StoreList = {
  stores: { name: string; code: string | null; manual?: boolean }[];
  source: "zoho" | "legacy";
  fetchedAt: string | null;
  error: string | null;
};

// The store list (from Zoho POS) used for Staff Users, the complaint form and
// Service Setup — plus a box to add a new store before its first Zoho bill.
export function ZohoStoresCard({ onChange }: { onChange?: () => void } = {}) {
  const [list, setList] = useState<StoreList | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    const response = await fetch(`/api/staff/admin/stores${refresh ? "?refresh=1" : ""}`).catch(() => null);
    const data = response ? await response.json().catch(() => null) : null;
    if (response?.ok && data) setList(data as StoreList);
    setBusy(false);
  }, []);

  useEffect(() => {
    const run = async () => {
      await load(false);
    };
    run();
  }, [load]);

  const send = async (method: "POST" | "DELETE", storeName: string) => {
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/staff/admin/stores", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: storeName }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (!response?.ok) {
      setError(data.error ?? "Unable to save.");
      return;
    }
    if (data.list) setList(data.list as StoreList);
    if (method === "POST") {
      setName("");
      setMessage(`${data.name} added. You can now choose it in Staff Users and Service Setup.`);
    } else {
      setMessage(`${storeName} removed.`);
    }
    onChange?.();
  };

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim()) send("POST", name);
  };

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-lg font-bold">Stores</p>
          <p className="text-sm text-black/55">
            Read from Zoho POS every 15 minutes, so a store appears after its first bill. Used for Staff Users, the
            complaint form and Service Setup.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={busy}
          className="rounded-xl border border-black/10 px-4 py-2 text-sm font-bold hover:bg-[#f7f9fb] disabled:opacity-50"
        >
          {busy ? "Checking..." : "Refresh from Zoho"}
        </button>
      </div>

      {list?.source === "legacy" && (
        <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
          Zoho POS is not connected yet — the old store list is used until it is.
        </p>
      )}
      {list?.error && <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{list.error}</p>}

      {list && list.stores.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-black/45">
              <tr>
                <th className="py-2 pr-4">Store</th>
                <th className="py-2 pr-4">From</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {list.stores.map((s) => (
                <tr key={s.name}>
                  <td className="py-2 pr-4 font-semibold">
                    {s.name}
                    {s.code ? <span className="ml-2 font-mono text-xs text-black/45">{s.code}</span> : null}
                  </td>
                  <td className="py-2 pr-4 text-xs">
                    {s.manual ? (
                      <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-800">Added by hand — no Zoho bill yet</span>
                    ) : (
                      <span className="text-black/50">Zoho POS</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {s.manual && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => window.confirm(`Remove ${s.name} from the store list?`) && send("DELETE", s.name)}
                        className="rounded-xl border border-black/10 px-3 py-1 text-xs font-bold hover:bg-[#f7f9fb] disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        list && !list.error && <p className="mt-3 text-sm text-black/55">No stores found.</p>
      )}

      <form onSubmit={add} className="mt-5 rounded-2xl bg-[#f7f9fb] p-4">
        <label htmlFor="new-store" className="block text-sm font-bold">
          Add a new store
        </label>
        <p className="mt-1 text-xs text-black/55">
          For a store that is opening and has no Zoho bill yet. Type the name <b>exactly as it is (or will be) in Zoho
          POS</b>, e.g. PERINTHALMANNA — the staff, complaints and service requests are matched to the bills by this
          name. When its first Zoho bill comes in, it is taken over by the Zoho entry automatically.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="new-store"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 uppercase outline-none focus:border-[#ff5e79]"
            placeholder="e.g. PERINTHALMANNA"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            Add store
          </button>
        </div>
        {message && <p className="mt-3 text-sm font-semibold text-green-700">{message}</p>}
        {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      </form>

      {list?.fetchedAt && (
        <p className="mt-3 text-xs text-black/45">Last read from Zoho: {formatDateTime(list.fetchedAt)}</p>
      )}
    </section>
  );
}
