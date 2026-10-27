"use client";

import { FormEvent, useState, type ReactNode } from "react";
import Link from "next/link";
import { ErrorBox, inputClass, labelClass, phoneInputClass } from "@/components/SiteChrome";
import { addMonths, formatDate, todayISO } from "@/lib/helpers";
import { EXTENDED_WARRANTY } from "@/lib/site-config";

type Row = {
  key: string;
  lineItemId: string;
  unitIndex: number;
  unitCount: number;
  productName: string;
  sku: string | null;
  suggestedModel: string;
  categoryName: string;
  standardMonths: number;
  extendedAllowed: boolean;
  existing: null | {
    warrantyNumber: string;
    token: string;
    modelNumber: string;
    serialNumber: string;
    customerName: string;
  };
};

type Ineligible = { name: string; sku: string | null; quantity: number; categoryName: string | null };

type Lookup = {
  bill: {
    billNumber: string;
    billDate: string;
    storeName: string | null;
    customer: { name: string; mobile: string; address: string };
    demo: boolean;
  };
  rows: Row[];
  ineligible: Ineligible[];
  categoriesConfigured: boolean;
};

type Entry = {
  modelNumber: string;
  serialNumber: string;
  customerName: string;
  customerMobile: string;
  customerAddress: string;
  extended: boolean;
};

type Saved = {
  id: string;
  warranty_number: string;
  verification_token: string;
  product_name: string;
  serial_number: string;
  customer_name: string;
  warranty_expiry_date: string;
};

const smallInput = inputClass.replace("px-4 py-3", "px-3 py-2.5 text-sm");
const smallPhone = phoneInputClass.replace("px-4 py-3", "px-3 py-2.5 text-sm");

export default function RegisterWarrantyStaffPage() {
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [fetching, setFetching] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorList, setErrorList] = useState<string[]>([]);
  const [saved, setSaved] = useState<Saved[] | null>(null);
  const [generating, setGenerating] = useState(false);

  const pendingRows = lookup?.rows.filter((r) => !r.existing) ?? [];
  const doneRows = lookup?.rows.filter((r) => r.existing) ?? [];

  // ---------------- Fetch bill ----------------
  const fetchBill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setErrorList([]);
    setLookup(null);
    setSaved(null);

    if (!billNumber.trim()) {
      setErrorMessage("Enter the bill number.");
      return;
    }

    setFetching(true);
    try {
      const response = await fetch("/api/staff/bill-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billNumber, billDate }),
      });
      const data = await response.json();

      if (response.status === 401) {
        window.location.href = "/staff/login";
        return;
      }
      if (!response.ok) {
        setErrorMessage(data.error || "Unable to fetch the bill.");
        return;
      }

      const result = data as Lookup;
      const initial: Record<string, Entry> = {};
      for (const row of result.rows) {
        if (row.existing) continue;
        initial[row.key] = {
          modelNumber: row.suggestedModel ?? "",
          serialNumber: "",
          customerName: result.bill.customer.name,
          customerMobile: result.bill.customer.mobile,
          customerAddress: result.bill.customer.address,
          extended: false,
        };
      }
      setEntries(initial);
      setLookup(result);
    } catch {
      setErrorMessage("Something went wrong while fetching the bill.");
    } finally {
      setFetching(false);
    }
  };

  const setField = (key: string, field: keyof Entry, value: string | boolean) => {
    setEntries((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const copyCustomerToAll = (fromKey: string) => {
    const source = entries[fromKey];
    if (!source) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = {
          ...next[key],
          customerName: source.customerName,
          customerMobile: source.customerMobile,
          customerAddress: source.customerAddress,
        };
      }
      return next;
    });
  };

  // ---------------- Save ----------------
  const save = async () => {
    if (!lookup) return;
    setErrorMessage("");
    setErrorList([]);

    const problems: string[] = [];
    pendingRows.forEach((row, index) => {
      const e = entries[row.key];
      const label = `Item ${index + 1} (${row.productName})`;
      if (!e.modelNumber.trim()) problems.push(`${label}: enter the model number.`);
      if (!e.serialNumber.trim()) problems.push(`${label}: enter the serial number.`);
      if (!e.customerName.trim()) problems.push(`${label}: enter the customer name.`);
      if (!/^[6-9]\d{9}$/.test(e.customerMobile.replace(/\D/g, "")))
        problems.push(`${label}: enter a valid 10-digit mobile number.`);
      if (e.customerAddress.trim().length < 5) problems.push(`${label}: enter the customer address.`);
      if ([e.modelNumber, e.serialNumber, e.customerName, e.customerAddress].some((v) => /[^\x20-\x7E\xA0-\xFF\r\n\t]/.test(v)))
        problems.push(`${label}: type all details in English letters (needed for the PDF certificate).`);
    });

    if (problems.length > 0) {
      setErrorMessage("Please complete the highlighted details.");
      setErrorList(problems);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/staff/warranties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billNumber: lookup.bill.billNumber,
          billDate: lookup.bill.billDate,
          items: pendingRows.map((row) => ({ key: row.key, ...entries[row.key] })),
        }),
      });
      const data = await response.json();

      if (response.status === 401) {
        window.location.href = "/staff/login";
        return;
      }
      if (!response.ok) {
        setErrorMessage(data.error || "Unable to save the warranties.");
        setErrorList(data.errors && data.errors.length > 1 ? data.errors : []);
        return;
      }

      setSaved(data.warranties ?? []);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrorMessage("Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Generate PDFs (one file per item) ----------------
  const downloadPdf = (token: string) => {
    const link = document.createElement("a");
    link.href = `/api/certificate/${token}/pdf`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const generateAll = async (tokens: string[]) => {
    setGenerating(true);
    for (const token of tokens) {
      downloadPdf(token);
      // small gap so the browser handles each download separately
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    setGenerating(false);
  };

  const startOver = () => {
    setLookup(null);
    setSaved(null);
    setEntries({});
    setBillNumber("");
    setBillDate(todayISO());
    setErrorMessage("");
    setErrorList([]);
  };

  // =================================================================
  // Saved — generate warranty cards
  // =================================================================
  if (saved) {
    return (
      <div className="space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl">✓</div>
          <h1 className="mt-5 text-2xl font-bold">
            {saved.length} warrant{saved.length === 1 ? "y" : "ies"} saved
          </h1>
          <p className="mt-1 text-sm text-black/60">
            Bill {lookup?.bill.billNumber} • {formatDate(lookup?.bill.billDate)}. A separate
            certificate is created for each item.
          </p>

          <button
            type="button"
            onClick={() => generateAll(saved.map((w) => w.verification_token))}
            disabled={generating}
            className="mt-6 w-full rounded-2xl bg-[#ff5e79] px-5 py-4 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-50 sm:w-auto"
          >
            {generating
              ? "Generating..."
              : `Generate Warranty Card${saved.length === 1 ? "" : "s"} (PDF)`}
          </button>
          {saved.length > 1 && (
            <p className="mt-2 text-xs text-black/45">
              If your browser asks, allow this site to download multiple files.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {saved.map((w, index) => (
            <div key={w.id} className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-black/40">
                  Item {index + 1} • {w.warranty_number}
                </p>
                <p className="mt-1 font-bold">{w.product_name}</p>
                <p className="text-sm text-black/55">
                  Serial {w.serial_number} • {w.customer_name} • Covered until {formatDate(w.warranty_expiry_date)}
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/certificate/${w.verification_token}/pdf?view=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl border border-black/10 px-4 py-2 text-sm font-bold hover:bg-[#f7f9fb]"
                >
                  View
                </a>
                <button
                  type="button"
                  onClick={() => downloadPdf(w.verification_token)}
                  className="rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white"
                >
                  Download PDF
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={startOver}
          className="rounded-2xl border border-black/10 bg-white px-6 py-3 font-bold"
        >
          Register Another Bill
        </button>
      </div>
    );
  }

  // =================================================================
  // Fetch + fill
  // =================================================================
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Register Warranty</h1>
        <p className="mt-2 text-sm text-black/60">
          Enter the Zoho POS bill number and date. Warranty-eligible items will appear below.
        </p>
      </div>

      <form
        onSubmit={fetchBill}
        className="grid gap-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:grid-cols-[1fr_200px_auto] sm:items-end"
      >
        <div>
          <label htmlFor="bill" className={labelClass}>Bill Number *</label>
          <input
            id="bill"
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            className={inputClass}
            placeholder="e.g. INV-004512"
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="date" className={labelClass}>Bill Date *</label>
          <input
            id="date"
            type="date"
            value={billDate}
            max={todayISO()}
            onChange={(e) => setBillDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={fetching}
          className="rounded-2xl bg-[#161616] px-6 py-3 font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {fetching ? "Fetching..." : "Fetch Bill"}
        </button>
      </form>

      {!lookup && <ErrorBox message={errorMessage} />}

      {lookup && (
        <>
          {lookup.bill.demo && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <span className="font-bold">Demo bill.</span> Zoho POS isn&apos;t connected yet, so
              this is sample data. To see eligible rows, add the categories{" "}
              <b>RECHARGEABLE JEEP</b> and <b>RECHARGEABLE BIKE</b> under Categories.
            </div>
          )}

          {/* Bill summary */}
          <div className="grid gap-4 rounded-3xl bg-[#161616] p-5 text-white sm:grid-cols-4">
            <Summary label="Bill Number" value={lookup.bill.billNumber} />
            <Summary label="Bill Date" value={formatDate(lookup.bill.billDate)} />
            <Summary label="Store" value={lookup.bill.storeName ?? "—"} />
            <Summary label="Customer (Zoho)" value={lookup.bill.customer.name || "—"} />
          </div>

          {!lookup.categoriesConfigured && (
            <ErrorBox message="No warranty categories are set up yet, so no items can be registered. An admin must add them under Categories." />
          )}

          {/* Already registered */}
          {doneRows.length > 0 && (
            <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <h2 className="font-bold">Already registered on this bill</h2>
              <div className="mt-3 space-y-2">
                {doneRows.map((row) => (
                  <div key={row.key} className="flex flex-col gap-2 rounded-2xl bg-[#f7f9fb] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold">
                        {row.productName}
                        {row.unitCount > 1 ? ` (unit ${row.unitIndex} of ${row.unitCount})` : ""}
                      </p>
                      <p className="text-black/55">
                        {row.existing!.warrantyNumber} • Serial {row.existing!.serialNumber} • {row.existing!.customerName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadPdf(row.existing!.token)}
                      className="rounded-xl bg-[#161616] px-4 py-2 text-xs font-bold text-white"
                    >
                      Download PDF
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rows to fill */}
          {pendingRows.length > 0 ? (
            <div className="space-y-4">
              <h2 className="text-lg font-bold">
                Warranty-eligible items ({pendingRows.length})
              </h2>

              {pendingRows.map((row, index) => {
                const e = entries[row.key];
                const standardEnd = addMonths(lookup.bill.billDate, row.standardMonths);
                const extendedEnd = addMonths(standardEnd, EXTENDED_WARRANTY.months);

                return (
                  <section key={row.key} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
                    <div className="flex flex-col gap-2 border-b border-black/5 pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ff5e79] text-sm font-bold text-white">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-bold">
                            {row.productName}
                            {row.unitCount > 1 && (
                              <span className="ml-2 rounded-full bg-[#11b8d0]/10 px-2 py-0.5 text-xs font-bold text-[#11b8d0]">
                                Unit {row.unitIndex} of {row.unitCount}
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-black/50">
                            {[row.categoryName, row.sku].filter(Boolean).join(" • ")} • {row.standardMonths}-month warranty until {formatDate(standardEnd)}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Model Number *">
                        <input value={e.modelNumber} onChange={(ev) => setField(row.key, "modelNumber", ev.target.value)} className={smallInput} />
                      </Field>
                      <Field label="Serial Number *">
                        <input value={e.serialNumber} onChange={(ev) => setField(row.key, "serialNumber", ev.target.value)} className={smallInput} />
                      </Field>
                      <Field label="Customer Name *">
                        <input value={e.customerName} onChange={(ev) => setField(row.key, "customerName", ev.target.value)} className={smallInput} />
                      </Field>
                      <Field label="Mobile Number *">
                        <div className="flex">
                          <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-3 text-xs font-semibold">+91</span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            maxLength={10}
                            value={e.customerMobile}
                            onChange={(ev) => setField(row.key, "customerMobile", ev.target.value.replace(/\D/g, ""))}
                            className={smallPhone}
                          />
                        </div>
                      </Field>
                      <div className="sm:col-span-2 lg:col-span-4">
                        <Field label="Customer Address *">
                          <textarea
                            rows={2}
                            value={e.customerAddress}
                            onChange={(ev) => setField(row.key, "customerAddress", ev.target.value)}
                            className={smallInput}
                          />
                        </Field>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      {row.extendedAllowed ? (
                        <label
                          className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                            e.extended ? "border-[#ff5e79] bg-[#ff5e79]/5" : "border-black/10"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={e.extended}
                            onChange={(ev) => setField(row.key, "extended", ev.target.checked)}
                            className="h-4 w-4 accent-[#ff5e79]"
                          />
                          <span>
                            <b>Extended Warranty</b> +{EXTENDED_WARRANTY.months} months ({EXTENDED_WARRANTY.feeLabel})
                            {e.extended && (
                              <span className="text-black/55"> — covered until {formatDate(extendedEnd)}</span>
                            )}
                          </span>
                        </label>
                      ) : (
                        <span className="text-xs text-black/40">Extended warranty not available for this category</span>
                      )}

                      {pendingRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => copyCustomerToAll(row.key)}
                          className="text-xs font-bold text-[#11b8d0] hover:underline"
                        >
                          Use this customer for all items
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}

              <ErrorBox message={errorMessage} />
              {errorList.length > 0 && (
                <ul className="list-disc space-y-1 pl-6 text-sm text-red-700">
                  {errorList.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="rounded-2xl bg-[#ff5e79] px-8 py-4 text-base font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : `Save ${pendingRows.length} Warrant${pendingRows.length === 1 ? "y" : "ies"}`}
                </button>
                <button type="button" onClick={startOver} className="rounded-2xl border border-black/10 bg-white px-6 py-4 font-bold">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            lookup.categoriesConfigured && (
              <div className="rounded-3xl bg-white p-6 text-sm shadow-sm ring-1 ring-black/5">
                <p className="font-bold">
                  {doneRows.length > 0
                    ? "All warranty-eligible items on this bill are already registered."
                    : "No warranty-eligible items on this bill."}
                </p>
                <Link href="/staff/register" onClick={startOver} className="mt-3 inline-block font-bold text-[#ff5e79]">
                  Fetch another bill
                </Link>
              </div>
            )
          )}

          {/* Not eligible */}
          {lookup.ineligible.length > 0 && (
            <details className="rounded-3xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/5">
              <summary className="cursor-pointer font-bold text-black/60">
                {lookup.ineligible.length} other item{lookup.ineligible.length === 1 ? "" : "s"} on this bill (not eligible for warranty)
              </summary>
              <ul className="mt-3 space-y-1 text-black/60">
                {lookup.ineligible.map((item, i) => (
                  <li key={`${item.name}-${i}`}>
                    {item.name} × {item.quantity}
                    <span className="text-black/40"> — Zoho category: {item.categoryName || "none"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-white/50">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-black/60">{label}</span>
      {children}
    </label>
  );
}
