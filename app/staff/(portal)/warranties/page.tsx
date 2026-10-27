"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ErrorBox, inputClass, StatusBadge } from "@/components/SiteChrome";
import { formatDate, statusLabel } from "@/lib/helpers";

type Warranty = {
  id: string;
  warranty_number: string;
  verification_token: string;
  bill_number: string;
  bill_date: string;
  product_name: string;
  model_number: string;
  serial_number: string;
  customer_name: string;
  customer_mobile: string;
  warranty_expiry_date: string;
  extended_warranty_purchased: boolean;
  status: string;
};

export default function StaffWarrantiesPage() {
  const [q, setQ] = useState("");
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const search = useCallback(async (term: string) => {
    setLoading(true);
    setErrorMessage("");
    const response = await fetch(`/api/staff/warranties?q=${encodeURIComponent(term)}`);
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = "/staff/login";
      return;
    }
    if (!response.ok) setErrorMessage(data.error || "Unable to load warranties.");
    else setWarranties(data.warranties ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const run = async () => {
      await search("");
    };
    run();
  }, [search]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search(q);
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Warranties</h1>
        <p className="mt-2 text-sm text-black/60">
          Latest 50 registrations. Search by bill number, warranty number, customer, mobile or serial number.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={inputClass}
          placeholder="Search..."
          aria-label="Search warranties"
        />
        <button type="submit" className="rounded-2xl bg-[#161616] px-6 font-bold text-white">
          Search
        </button>
      </form>

      <ErrorBox message={errorMessage} />

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
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
                        <p className="text-xs text-black/50">{formatDate(w.bill_date)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{w.product_name}</p>
                        <p className="text-xs text-black/50">
                          Model {w.model_number} • S/N {w.serial_number}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{w.customer_name}</p>
                        <p className="text-xs text-black/50">+91 {w.customer_mobile}</p>
                      </td>
                      <td className="px-4 py-3">
                        {formatDate(w.warranty_expiry_date)}
                        {w.extended_warranty_purchased && (
                          <p className="text-xs font-bold text-[#ff5e79]">Extended</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <a
                            href={`/api/certificate/${w.verification_token}/pdf?view=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-xl border border-black/10 px-3 py-1.5 text-xs font-bold hover:bg-[#f7f9fb]"
                          >
                            View
                          </a>
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
    </div>
  );
}
