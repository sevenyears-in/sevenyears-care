"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox } from "@/components/SiteChrome";
import { ZohoStoresCard } from "@/components/ZohoStoresCard";

type Data = {
  stores: { name: string; staffId: string }[];
  people: { id: string; fullName: string; role: string; storeName: string | null }[];
};

export default function ServiceSetupPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/staff/admin/store-technicians").catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    if (response?.ok) setData(body as Data);
    else setError(body.error ?? "Unable to load.");
  }, []);

  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
  }, [load]);

  const save = async (storeName: string, staffId: string) => {
    setSaving(storeName);
    setError("");
    setNotice("");
    const response = await fetch("/api/staff/admin/store-technicians", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeName, staffId }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setSaving("");
    if (!response?.ok) setError(body.error ?? "Unable to save.");
    else {
      const person = data?.people.find((p) => p.id === staffId);
      setNotice(
        person
          ? `New service requests from ${storeName} will go straight to ${person.fullName}.`
          : `${storeName}: new requests are no longer assigned automatically.`
      );
    }
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Service Setup</h1>
        <p className="mt-2 text-sm text-black/60">
          Choose who does the technician work at each store. New service requests from that store are assigned to this
          person automatically and appear under “Assigned to me”. Where the Service Head also does the technician work
          (for example Vadakara), choose the Service Head. Leave it on “No default” to assign each request by hand.
        </p>
      </div>

      <ErrorBox message={error} />
      {notice && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">{notice}</div>
      )}

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
        {!data ? (
          <p className="p-5 text-sm text-black/55">Loading...</p>
        ) : data.stores.length === 0 ? (
          <p className="p-5 text-sm text-black/55">No stores found. Check the Zoho POS connection.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f7f9fb] text-xs uppercase tracking-wider text-black/45">
              <tr>
                <th className="px-5 py-3">Store</th>
                <th className="px-5 py-3">Technician work done by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {data.stores.map((s) => (
                <tr key={s.name}>
                  <td className="px-5 py-3 font-semibold">{s.name}</td>
                  <td className="px-5 py-3">
                    <select
                      value={s.staffId}
                      disabled={saving === s.name}
                      onChange={(e) => save(s.name, e.target.value)}
                      className="w-full max-w-sm rounded-xl border border-black/10 px-3 py-2 disabled:opacity-50"
                      aria-label={`Technician for ${s.name}`}
                    >
                      <option value="">No default — assign by hand</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.fullName} — {p.role}
                          {p.storeName ? `, ${p.storeName}` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.people.length === 0 && (
        <p className="text-sm text-black/55">
          No active Technicians or Service Heads yet — add them under Staff Users first.
        </p>
      )}

      <ZohoStoresCard onChange={load} />
    </div>
  );
}
