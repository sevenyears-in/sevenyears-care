"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";

type Category = {
  id: string;
  category_name: string;
  standard_months: number;
  extended_allowed: boolean;
  is_active: boolean;
};

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [name, setName] = useState("");
  const [months, setMonths] = useState("6");
  const [extendedAllowed, setExtendedAllowed] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/staff/admin/categories");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setErrorMessage(data.error || "Unable to load categories.");
    else setCategories(data.categories ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
  }, [load]);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSaving(true);
    const response = await fetch("/api/staff/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryName: name, standardMonths: Number(months), extendedAllowed }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setErrorMessage(data.error || "Unable to add the category.");
      return;
    }
    setName("");
    setMonths("6");
    setExtendedAllowed(true);
    load();
  };

  const update = async (id: string, change: Record<string, unknown>) => {
    setErrorMessage("");
    const response = await fetch("/api/staff/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...change }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setErrorMessage(data.error || "Unable to update.");
    load();
  };

  const remove = async (category: Category) => {
    if (!window.confirm(`Remove "${category.category_name}" from the warranty list?`)) return;
    const response = await fetch(`/api/staff/admin/categories?id=${category.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) setErrorMessage(data.error || "Unable to remove.");
    load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Warranty Categories</h1>
        <p className="mt-2 max-w-2xl text-sm text-black/60">
          Items on a Zoho POS bill appear for warranty registration only when their Zoho
          category is listed (and active) here. Type the category name exactly as it is in
          Zoho POS — capital letters don&apos;t matter. Tip: fetch a bill on the Register
          screen; items that aren&apos;t eligible show their Zoho category name.
        </p>
      </div>

      <form onSubmit={add} className="grid gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:grid-cols-[1fr_140px_auto_auto] sm:items-end">
        <div>
          <label htmlFor="cat" className={labelClass}>Zoho Category Name</label>
          <input id="cat" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Strollers" />
        </div>
        <div>
          <label htmlFor="months" className={labelClass}>Warranty (months)</label>
          <input id="months" type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 pb-3 text-sm font-semibold">
          <input type="checkbox" checked={extendedAllowed} onChange={(e) => setExtendedAllowed(e.target.checked)} className="h-4 w-4 accent-[#ff5e79]" />
          Extended allowed
        </label>
        <button type="submit" disabled={saving} className="rounded-2xl bg-[#ff5e79] px-5 py-3 font-bold text-white disabled:opacity-50">
          {saving ? "Adding..." : "Add"}
        </button>
      </form>

      <ErrorBox message={errorMessage} />

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
        {loading ? (
          <p className="p-5 text-sm text-black/60">Loading...</p>
        ) : categories.length === 0 ? (
          <p className="p-5 text-sm text-black/60">No categories yet. Add your first one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-[#f7f9fb] text-xs uppercase tracking-wider text-black/45">
                <tr>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Warranty</th>
                  <th className="px-5 py-3">Extended</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {categories.map((c) => (
                  <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
                    <td className="px-5 py-3 font-semibold">{c.category_name}</td>
                    <td className="px-5 py-3">
                      <select
                        value={c.standard_months}
                        onChange={(e) => update(c.id, { standardMonths: Number(e.target.value) })}
                        className="rounded-xl border border-black/10 px-2 py-1"
                        aria-label={`Warranty months for ${c.category_name}`}
                      >
                        {[...new Set([1, 3, 6, 12, 18, 24, 36, 60, c.standard_months])]
                          .sort((a, b) => a - b)
                          .map((m) => (
                            <option key={m} value={m}>{m} months</option>
                          ))}
                      </select>
                    </td>
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={c.extended_allowed}
                        onChange={(e) => update(c.id, { extendedAllowed: e.target.checked })}
                        className="h-4 w-4 accent-[#ff5e79]"
                        aria-label={`Extended warranty allowed for ${c.category_name}`}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={() => update(c.id, { isActive: !c.is_active })}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${c.is_active ? "bg-green-100 text-green-800" : "bg-black/10 text-black/60"}`}
                      >
                        {c.is_active ? "Active" : "Paused"}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" onClick={() => remove(c)} className="text-xs font-bold text-red-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
