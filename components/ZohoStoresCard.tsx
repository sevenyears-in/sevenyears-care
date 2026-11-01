"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "@/lib/helpers";

type StoreList = {
  stores: { name: string; code: string | null }[];
  source: "zoho" | "legacy";
  fetchedAt: string | null;
  error: string | null;
};

// Shows the stores read from Zoho POS (used for Staff Users and the complaint form).
export function ZohoStoresCard() {
  const [list, setList] = useState<StoreList | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-lg font-bold">Stores from Zoho POS</p>
          <p className="text-sm text-black/55">
            Used for Staff Users and the customer complaint form. Checked again every 15 minutes, so new Zoho stores
            appear automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={busy}
          className="rounded-xl border border-black/10 px-4 py-2 text-sm font-bold hover:bg-[#f7f9fb] disabled:opacity-50"
        >
          {busy ? "Checking..." : "Refresh now"}
        </button>
      </div>

      {list?.source === "legacy" && (
        <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
          Zoho POS is not connected yet — the old store list is used until it is.
        </p>
      )}
      {list?.error && (
        <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{list.error}</p>
      )}

      {list && list.stores.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-black/45">
              <tr>
                <th className="py-2 pr-4">Store</th>
                <th className="py-2">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {list.stores.map((s) => (
                <tr key={s.name}>
                  <td className="py-2 pr-4 font-semibold">{s.name}</td>
                  <td className="py-2 font-mono text-xs">{s.code ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        list && !list.error && <p className="mt-3 text-sm text-black/55">No stores found.</p>
      )}

      {list?.fetchedAt && (
        <p className="mt-3 text-xs text-black/45">Last read from Zoho: {formatDateTime(list.fetchedAt)}</p>
      )}
    </section>
  );
}
