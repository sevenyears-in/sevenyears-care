"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, StatusBadge } from "@/components/SiteChrome";
import { formatDate, statusLabel, todayISO } from "@/lib/helpers";
import { WarrantyMonthSummary } from "@/components/WarrantyMonthSummary";

type Warranty = {
  id: string;
  warranty_number: string;
  verification_token: string;
  bill_number: string;
  bill_date: string;
  store_name: string | null;
  product_name: string;
  model_number: string;
  serial_number: string;
  customer_name: string;
  customer_mobile: string;
  alternate_name: string | null;
  alternate_mobile: string | null;
  warranty_expiry_date: string;
  extended_warranty_purchased: boolean;
  status: string;
};

type Filters = { q: string; store: string; from: string; to: string; status: string };
const EMPTY: Filters = { q: "", store: "", from: "", to: "", status: "" };

const STATUS_OPTIONS = [
  { value: "", label: "All warranties" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "gift", label: "Gifts" },
  { value: "incomplete", label: "Details to complete" },
  { value: "void", label: "Void" },
];

const small = inputClass.replace("px-4 py-3", "px-3 py-2.5 text-sm");

function queryString(f: Filters, page?: number) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  if (page && page > 1) p.set("page", String(page));
  return p.toString();
}

export default function StaffWarrantiesPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [stores, setStores] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    fetch("/api/staff/warranties/stores")
      .then((r) => r.json())
      .then((d) => setStores(d.stores ?? []))
      .catch(() => null);
  }, []);

  const load = useCallback(async (f: Filters, p: number) => {
    setLoading(true);
    setErrorMessage("");
    const response = await fetch(`/api/staff/warranties?${queryString(f, p)}`, { cache: "no-store" }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (response?.status === 401) {
      window.location.href = "/staff/login";
      return;
    }
    if (!response?.ok) setErrorMessage(data.error || "Unable to load warranties.");
    else {
      setWarranties(data.warranties ?? []);
      setTotal(data.total ?? 0);
      setPageSize(data.pageSize ?? 50);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(filters, page);
  }, [filters, page, load]);

  const apply = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setPage(1);
    setFilters({ ...draft });
  };
  const clear = () => {
    setDraft(EMPTY);
    setPage(1);
    setFilters(EMPTY);
  };
  const set = (k: keyof Filters, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, page * pageSize);
  const filtered = Object.values(filters).some(Boolean);

  const today = todayISO();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Warranties</h1>
          <p className="mt-2 text-sm text-black/60">Search, filter by store and bill date, or download the full details.</p>
        </div>
        <div className="rounded-3xl bg-white px-5 py-3 text-right soft-card ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wider text-black/45">{filtered ? "Matching" : "Total"} warranties</p>
          <p className="text-3xl font-bold">{loading && total === 0 ? "…" : total.toLocaleString("en-IN")}</p>
        </div>
      </div>

      <form onSubmit={apply} className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.3fr_1fr_1fr_1.2fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-black/55">Search</span>
            <input
              value={draft.q}
              onChange={(e) => set("q", e.target.value)}
              className={small}
              placeholder="Bill, warranty no., name, mobile, serial…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-black/55">Store</span>
            <select value={draft.store} onChange={(e) => set("store", e.target.value)} className={small}>
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-black/55">Bill date from</span>
            <input type="date" value={draft.from} max={draft.to || today} onChange={(e) => set("from", e.target.value)} className={small} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-black/55">Bill date to</span>
            <input type="date" value={draft.to} min={draft.from} max={today} onChange={(e) => set("to", e.target.value)} className={small} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-black/55">Show</span>
            <select value={draft.status} onChange={(e) => set("status", e.target.value)} className={small}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-2xl bg-[#161616] px-5 py-2.5 text-sm font-bold text-white">
            Apply
          </button>
          {filtered && (
            <button type="button" onClick={clear} className="rounded-2xl px-4 py-2.5 text-sm font-bold ring-1 ring-black/10">
              Clear
            </button>
          )}
          <a
            href={`/api/staff/warranties/export?${queryString(filters)}`}
            className="ml-auto rounded-2xl bg-[#11b8d0] px-4 py-2.5 text-sm font-bold text-white"
          >
            ⬇ Download full details (Excel)
          </a>
        </div>
      </form>

      <WarrantyMonthSummary query={queryString({ ...EMPTY, store: filters.store, from: filters.from, to: filters.to })} />

      <ErrorBox message={errorMessage} />

      <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
        {loading ? (
          <p className="p-5 text-sm text-black/60">Loading...</p>
        ) : warranties.length === 0 ? (
          <p className="p-5 text-sm text-black/60">No warranties found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-[#f7f9fb] text-xs uppercase tracking-wider text-black/45">
                <tr>
                  <th className="px-4 py-3">Warranty</th>
                  <th className="px-4 py-3">Bill</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Covered Until</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {warranties.map((w) => {
                  const status =
                    w.status === "active" && w.warranty_expiry_date < today ? "expired" : w.status;
                  return (
                    <tr key={w.id}>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-bold">{w.warranty_number}</p>
                        <div className="mt-1">
                          <StatusBadge status={status} label={statusLabel(status)} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{w.bill_number}</p>
                        <p className="text-xs text-black/50">
                          {formatDate(w.bill_date)}
                          {w.store_name ? ` · ${w.store_name}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{w.product_name}</p>
                        <p className="text-xs text-black/50">
                          Model {w.model_number} •{" "}
                          {w.serial_number === "Not recorded" ? (
                            <span className="font-semibold text-amber-700">S/N to be added</span>
                          ) : (
                            <>S/N {w.serial_number}</>
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{w.customer_name}</p>
                        <p className="text-xs text-black/50">+91 {w.customer_mobile}</p>
                        {w.alternate_mobile && (
                          <p className="text-xs text-[#ff5e79]">
                            🎁 {w.alternate_name} · +91 {w.alternate_mobile}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {formatDate(w.warranty_expiry_date)}
                        {w.extended_warranty_purchased && (
                          <p className="text-xs font-bold text-[#ff5e79]">Extended</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/staff/warranties/${w.id}`}
                            className="rounded-xl border border-black/10 px-3 py-1.5 text-xs font-bold hover:bg-[#f7f9fb]"
                          >
                            View
                          </Link>
                          <a
                            href={`/api/certificate/${w.verification_token}/pdf`}
                            className="rounded-xl bg-[#161616] px-3 py-1.5 text-xs font-bold text-white"
                          >
                            PDF
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-black/55">
            Showing {firstRow.toLocaleString("en-IN")}–{lastRow.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-xl px-3 py-2 font-bold ring-1 ring-black/10 disabled:opacity-30"
            >
              ← Previous
            </button>
            <span className="text-black/55">
              Page {page} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl px-3 py-2 font-bold ring-1 ring-black/10 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
