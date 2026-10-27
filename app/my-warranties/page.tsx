"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  cardClass,
  ErrorBox,
  inputClass,
  phoneInputClass,
  labelClass,
  PageShell,
  primaryButtonClass,
  StatusBadge,
} from "@/components/SiteChrome";
import { formatDate, statusLabel } from "@/lib/helpers";

type Warranty = {
  warrantyNumber: string;
  productName: string;
  categoryName: string | null;
  sku: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  storeName: string | null;
  billNumber: string | null;
  billDate: string | null;
  startDate: string;
  expiryDate: string;
  extended: boolean;
  status: string;
  certificateToken: string | null;
};

export default function MyWarrantiesPage() {
  const [mobileNumber, setMobileNumber] = useState("");
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [warranties, setWarranties] = useState<Warranty[] | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setWarranties(null);

    const mobile = mobileNumber.replace(/\D/g, "");

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage("Please enter a valid 10-digit mobile number.");
      return;
    }

    if (!reference.trim()) {
      setErrorMessage("Please enter a warranty number or bill number.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/warranty/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobileNumber: mobile, reference }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to find warranties.");
        return;
      }

      setCustomerName(data.customerName ?? "");
      setWarranties(data.warranties ?? []);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell
      title="My Warranties"
      intro="See all products registered with your mobile number. For your security, enter one warranty number or bill number from any of your purchases."
    >
      {warranties === null ? (
        <div className={cardClass}>
          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="mobile" className={labelClass}>
                Mobile Number *
              </label>
              <div className="flex">
                <div className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">
                  +91
                </div>
                <input
                  id="mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={mobileNumber}
                  onChange={(e) => setMobileNumber(e.target.value)}
                  maxLength={10}
                  className={phoneInputClass}
                  placeholder="10-digit mobile number"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reference" className={labelClass}>
                Warranty Number or Bill Number *
              </label>
              <input
                id="reference"
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className={inputClass}
                placeholder="e.g. SY-WAR-2026-123456 or bill number"
              />
            </div>

            <ErrorBox message={errorMessage} />

            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? "Searching..." : "Show My Warranties"}
            </button>

            <p className="text-center text-sm text-black/50">
              Warranties are registered by our staff at the time of purchase.
              Can&apos;t find yours?{" "}
              <Link href="/register-complaint" className="font-bold text-[#ff5e79]">
                Let us know
              </Link>
            </p>
          </form>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-black/60">
              {customerName ? `Hi ${customerName}, ` : ""}
              {warranties.length} registered product
              {warranties.length === 1 ? "" : "s"} found.
            </p>
            <button
              type="button"
              onClick={() => setWarranties(null)}
              className="text-sm font-bold text-black/50 hover:text-black"
            >
              Search again
            </button>
          </div>

          {warranties.map((w) => (
            <article key={w.warrantyNumber} className={cardClass}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-black/40">
                    {w.warrantyNumber}
                  </p>
                  <h2 className="mt-1 text-xl font-bold">{w.productName}</h2>
                  <p className="mt-1 text-sm text-black/55">
                    {[w.categoryName, w.modelNumber ? `Model ${w.modelNumber}` : null].filter(Boolean).join(" • ") || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={w.status} label={statusLabel(w.status)} />
                  {w.extended && (
                    <span className="inline-flex rounded-full bg-[#ff5e79]/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#ff5e79]">
                      Extended
                    </span>
                  )}
                </div>
              </div>

              <dl className="mt-5 grid gap-4 rounded-2xl bg-[#f7f9fb] p-4 text-sm sm:grid-cols-3">
                <Item label="Purchased" value={formatDate(w.billDate)} />
                <Item label="Covered Until" value={formatDate(w.expiryDate)} />
                <Item label="Store" value={w.storeName ?? "—"} />
                <Item label="Bill No." value={w.billNumber ?? "—"} />
                <Item label="Serial No." value={w.serialNumber ?? "—"} />
              </dl>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                {w.certificateToken && (
                  <Link
                    href={`/warranty/${w.certificateToken}`}
                    className="rounded-2xl bg-[#161616] px-5 py-3 text-center text-sm font-bold text-white transition hover:opacity-90"
                  >
                    View Certificate
                  </Link>
                )}
                <Link
                  href={`/request-service?warranty=${encodeURIComponent(w.warrantyNumber)}`}
                  className="rounded-2xl border border-black/10 px-5 py-3 text-center text-sm font-bold transition hover:bg-[#f7f9fb]"
                >
                  Request Service
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-black/40">
        {label}
      </dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}
