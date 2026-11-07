"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, labelClass } from "@/components/SiteChrome";

export type EditableWarranty = {
  id: string;
  customerName: string;
  customerMobile: string;
  customerAddress: string;
  productName: string;
  modelNumber: string;
  categoryName: string | null;
  serialNumber: string;
  warrantyStartDate: string;
  standardExpiry: string;
  coveredUntil: string;
};

/** "Edit warranty" — Store Manager: customer & product. Super Admin: also serial and dates. */
export function EditWarranty({ w, full, categories }: { w: EditableWarranty; full: boolean; categories: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(w);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof EditableWarranty, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/staff/warranties/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", ...f }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Unable to save.");
    setOpen(false);
    router.refresh();
  };

  const field = (label: string, k: keyof EditableWarranty, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input value={String(f[k] ?? "")} onChange={(e) => set(k, e.target.value)} className={inputClass} {...props} />
    </label>
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-bold hover:bg-[#f7f9fb]">
        ✏️ Edit warranty
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Edit warranty</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-2xl text-black/40" aria-label="Close">
            ×
          </button>
        </div>

        <p className="mt-4 text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Customer</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {field("Customer name", "customerName")}
          {field("Customer mobile", "customerMobile", { inputMode: "numeric", maxLength: 10 })}
          <div className="sm:col-span-2">{field("Address", "customerAddress")}</div>
        </div>

        <p className="mt-5 text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Product</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("Product name", "productName")}</div>
          {field("Model number", "modelNumber")}
          <label className="block">
            <span className={labelClass}>Category</span>
            <select value={f.categoryName ?? ""} onChange={(e) => set("categoryName", e.target.value)} className={inputClass}>
              {!categories.includes(f.categoryName ?? "") && <option value={f.categoryName ?? ""}>{f.categoryName || "—"}</option>}
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {full && field("Serial number", "serialNumber")}
        </div>

        {full && (
          <>
            <p className="mt-5 text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Warranty dates (Super Admin)</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {field("Warranty starts", "warrantyStartDate", { type: "date" })}
              {field("Standard warranty until", "standardExpiry", { type: "date" })}
              {field("Covered until", "coveredUntil", { type: "date" })}
            </div>
          </>
        )}

        {error && <p className="mt-4 text-sm text-[#d43852]">{error}</p>}
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={save} disabled={busy} className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="px-4 py-3 text-sm text-black/50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
