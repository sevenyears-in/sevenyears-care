"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";
import { PasswordInput } from "@/components/PasswordInput";

type Gateway = "razorpay" | "paytm" | "icici";

type View = {
  price: number;
  months: number;
  windowDays: number;
  onlineEnabled: boolean;
  gateway: Gateway;
  ready: Record<Gateway, boolean>;
  razorpayKeyId: string;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
  testMode: boolean;
  webhookUrl: string;
  paytmMid: string;
  paytmKeySet: boolean;
  paytmWebsite: string;
  paytmStaging: boolean;
  paytmCallbackUrl: string;
  iciciMerchantId: string;
  iciciSubMerchantId: string;
  iciciKeySet: boolean;
  iciciPaymode: string;
  iciciReturnUrl: string;
};

const GATEWAYS: { value: Gateway; label: string; note: string }[] = [
  { value: "razorpay", label: "Razorpay", note: "UPI, cards, net banking, wallets" },
  { value: "paytm", label: "Paytm", note: "UPI, Paytm wallet, cards, net banking" },
  { value: "icici", label: "ICICI Bank (Eazypay)", note: "ICICI's payment gateway for businesses" },
];

const card = "soft-card rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-6";
const darkBtn = "rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40";

export default function ExtendedWarrantySettingsPage() {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fill = (d: View) => {
    setView(d);
    setForm({
      price: String(d.price),
      razorpayKeyId: d.razorpayKeyId,
      razorpayKeySecret: "",
      razorpayWebhookSecret: "",
      paytmMid: d.paytmMid,
      paytmKey: "",
      paytmWebsite: d.paytmWebsite,
      paytmStaging: d.paytmStaging,
      iciciMerchantId: d.iciciMerchantId,
      iciciSubMerchantId: d.iciciSubMerchantId,
      iciciAesKey: "",
      iciciPaymode: d.iciciPaymode,
    });
  };

  useEffect(() => {
    fetch("/api/staff/admin/extended-warranty")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load.");
        fill(d);
      })
      .catch((e) => setError(e.message));
  }, []);

  const save = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    const r = await fetch("/api/staff/admin/extended-warranty", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) {
      setError(d.error || "Unable to save.");
      return;
    }
    fill(d);
    setNotice(ok);
  };

  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const val = (k: string) => String(form[k] ?? "");

  if (!view) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Extended Warranty &amp; Payments</h1>
        {error ? <ErrorBox message={error} /> : <p className="text-sm text-black/55">Loading…</p>}
      </div>
    );
  }

  const copy = (value: string) => navigator.clipboard?.writeText(value).then(() => setNotice("Copied."));
  const CopyRow = ({ label, value }: { label: string; value: string }) => (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} className={`${inputClass} font-mono text-xs`} />
        <button type="button" onClick={() => copy(value)} className="shrink-0 rounded-2xl border border-black/10 px-4 text-sm font-bold">
          Copy
        </button>
      </div>
    </div>
  );
  const Field = ({ id, label, placeholder, children }: { id: string; label: ReactNode; placeholder?: string; children?: ReactNode }) => (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children ?? <input id={id} value={val(id)} onChange={set(id)} className={inputClass} placeholder={placeholder} />}
    </div>
  );
  const Secret = ({ id, label, saved, placeholder }: { id: string; label: string; saved: boolean; placeholder: string }) => (
    Field({
      id,
      label: (
        <>
          {label} {saved && <span className="font-normal text-green-700">(saved — leave blank to keep)</span>}
        </>
      ),
      children: (
        <PasswordInput
          id={id}
          autoComplete="off"
          value={val(id)}
          onChange={set(id)}
          className={inputClass}
          placeholder={saved ? "••••••••" : placeholder}
        />
      ),
    })
  );
  const Steps = ({ title, children }: { title: string; children: ReactNode }) => (
    <details className="rounded-2xl bg-[#f7f9fb] p-4 text-sm leading-6">
      <summary className="cursor-pointer font-bold">{title}</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-black/70">{children}</ol>
    </details>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Extended Warranty &amp; Payments</h1>
        <p className="mt-2 text-sm text-black/60">
          +{view.months} months on top of the standard warranty. Within {view.windowDays} days of purchase customers can buy it
          online straight away; later, a technician inspects the product first.
        </p>
      </div>

      {notice && <p className="rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
      <ErrorBox message={error} />

      {/* Price */}
      <section className={card}>
        <h2 className="text-lg font-bold">1. Price</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="price" className={labelClass}>
              Price (₹)
            </label>
            <input
              id="price"
              inputMode="numeric"
              value={val("price")}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value.replace(/[^\d]/g, "") }))}
              className={`${inputClass} w-40`}
            />
          </div>
          <button
            type="button"
            disabled={busy || !val("price") || Number(val("price")) === view.price}
            onClick={() => save({ price: Number(val("price")) }, `Price saved: ₹${Number(val("price")).toLocaleString("en-IN")}.`)}
            className={darkBtn}
          >
            Save price
          </button>
        </div>
        <p className="mt-2 text-xs text-black/50">
          Used everywhere at once: billing (Register Warranty), the customer&apos;s online payment and the certificate.
          Requests already approved keep the price they were approved at.
        </p>
      </section>

      {/* Payment company */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">2. Online payment</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              view.onlineEnabled ? "bg-green-50 text-green-700 ring-1 ring-green-200" : "bg-black/5 text-black/55"
            }`}
          >
            {view.onlineEnabled ? `ON · ${GATEWAYS.find((g) => g.value === view.gateway)?.label}${view.testMode ? " · TEST" : ""}` : "OFF"}
          </span>
        </div>
        <p className="mt-2 text-sm text-black/60">Choose the company customers pay through. Only one is used at a time.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {GATEWAYS.map((g) => (
            <button
              key={g.value}
              type="button"
              disabled={busy}
              onClick={() => g.value !== view.gateway && save({ gateway: g.value }, `${g.label} selected.`)}
              className={`rounded-2xl p-4 text-left ring-1 transition ${
                view.gateway === g.value ? "bg-[#ff5e79]/5 ring-2 ring-[#ff5e79]" : "bg-white ring-black/10 hover:ring-black/25"
              }`}
            >
              <p className="font-bold">
                {view.gateway === g.value ? "● " : "○ "}
                {g.label}
              </p>
              <p className="mt-1 text-xs text-black/55">{g.note}</p>
              <p className={`mt-2 text-[11px] font-bold ${view.ready[g.value] ? "text-green-700" : "text-black/40"}`}>
                {view.ready[g.value] ? "Details saved" : "Not set up"}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-4 border-t border-black/5 pt-5">
          {view.gateway === "razorpay" && (
            <>
              {Steps({ title: "How to get the Razorpay keys (step by step)", children: (<>
                <li>
                  Go to <b>razorpay.com</b> → <b>Sign up</b> with the business e-mail and mobile. Complete KYC (PAN, GST, bank
                  account) — usually 1–3 working days.
                </li>
                <li>
                  Dashboard → <b>Account &amp; Settings → API Keys → Generate Key</b>. Use <b>Test mode</b> first, then{" "}
                  <b>Live mode</b>.
                </li>
                <li>
                  Copy the <b>Key ID</b> (<code>rzp_live_…</code>) and the <b>Key Secret</b> (shown only once) into the boxes below.
                </li>
                <li>
                  <b>Account &amp; Settings → Webhooks → Add New Webhook</b>: paste the Webhook URL below, make up a long{" "}
                  <b>Secret</b>, tick <b>payment.captured</b> and <b>order.paid</b>. Paste the same secret below.
                </li>
              </>) })}
              {Field({ id: "razorpayKeyId", label: "Key ID", placeholder: "rzp_live_…" })}
              {Secret({ id: "razorpayKeySecret", label: "Key Secret", saved: view.keySecretSet, placeholder: "Paste the Key Secret" })}
              {CopyRow({ label: "Webhook URL (paste this into Razorpay)", value: view.webhookUrl })}
              {Secret({ id: "razorpayWebhookSecret", label: "Webhook Secret", saved: view.webhookSecretSet, placeholder: "The same secret you typed in Razorpay" })}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  save(
                    {
                      razorpayKeyId: val("razorpayKeyId"),
                      razorpayKeySecret: val("razorpayKeySecret"),
                      razorpayWebhookSecret: val("razorpayWebhookSecret"),
                    },
                    "Razorpay details saved."
                  )
                }
                className={darkBtn}
              >
                Save Razorpay details
              </button>
            </>
          )}

          {view.gateway === "paytm" && (
            <>
              {Steps({ title: "How to get the Paytm details (step by step)", children: (<>
                <li>
                  Go to <b>business.paytm.com</b> → sign up for <b>Payment Gateway</b> and complete KYC (PAN, GST, bank
                  account).
                </li>
                <li>
                  Paytm Business Dashboard → <b>Developer Settings → API Keys</b>. Use <b>Test API details</b> first (tick
                  “Test mode” below), then <b>Production API details</b>.
                </li>
                <li>
                  Copy the <b>Merchant ID (MID)</b>, <b>Merchant Key</b> and <b>Website name</b> (usually <code>DEFAULT</code> in
                  production, <code>WEBSTAGING</code> in test) into the boxes below.
                </li>
                <li>If Paytm asks for a callback / return URL, give them the address below.</li>
              </>) })}
              {Field({ id: "paytmMid", label: "Merchant ID (MID)", placeholder: "e.g. SevenY12345678901234" })}
              {Secret({ id: "paytmKey", label: "Merchant Key", saved: view.paytmKeySet, placeholder: "Paste the Merchant Key" })}
              {Field({ id: "paytmWebsite", label: "Website name", placeholder: "DEFAULT" })}
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={Boolean(form.paytmStaging)}
                  onChange={(e) => setForm((f) => ({ ...f, paytmStaging: e.target.checked }))}
                  className="h-4 w-4 accent-[#ff5e79]"
                />
                Test mode (Paytm staging — no real money)
              </label>
              {CopyRow({ label: "Callback URL", value: view.paytmCallbackUrl })}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  save(
                    {
                      paytmMid: val("paytmMid"),
                      paytmKey: val("paytmKey"),
                      paytmWebsite: val("paytmWebsite"),
                      paytmStaging: Boolean(form.paytmStaging),
                    },
                    "Paytm details saved."
                  )
                }
                className={darkBtn}
              >
                Save Paytm details
              </button>
            </>
          )}

          {view.gateway === "icici" && (
            <>
              {Steps({ title: "How to get the ICICI Eazypay details (step by step)", children: (<>
                <li>
                  Ask your ICICI Bank branch / relationship manager for <b>Eazypay</b> (online payment collection) on your
                  current account.
                </li>
                <li>
                  ICICI shares an on-boarding form — give them the <b>Return URL</b> below as your website&apos;s return URL.
                </li>
                <li>
                  ICICI sends you the <b>Merchant ID</b> (ICID), <b>Sub-merchant ID</b> and the <b>encryption (AES) key</b>.
                  Paste them below. <b>Payment mode</b> 9 means all modes (UPI, cards, net banking).
                </li>
                <li>Ask ICICI for a test transaction before going live.</li>
              </>) })}
              {Field({ id: "iciciMerchantId", label: "Merchant ID (ICID)", placeholder: "e.g. 123456" })}
              {Field({ id: "iciciSubMerchantId", label: "Sub-merchant ID", placeholder: "e.g. 45" })}
              {Secret({ id: "iciciAesKey", label: "Encryption (AES) key", saved: view.iciciKeySet, placeholder: "16-character key from ICICI" })}
              {Field({ id: "iciciPaymode", label: "Payment mode", placeholder: "9" })}
              {CopyRow({ label: "Return URL (give this to ICICI)", value: view.iciciReturnUrl })}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  save(
                    {
                      iciciMerchantId: val("iciciMerchantId"),
                      iciciSubMerchantId: val("iciciSubMerchantId"),
                      iciciAesKey: val("iciciAesKey"),
                      iciciPaymode: val("iciciPaymode"),
                    },
                    "ICICI details saved."
                  )
                }
                className={darkBtn}
              >
                Save ICICI details
              </button>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-black/5 pt-5">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              save({ onlineEnabled: !view.onlineEnabled }, view.onlineEnabled ? "Online payments turned off." : "Online payments turned on.")
            }
            className={`rounded-2xl px-5 py-3 text-sm font-bold disabled:opacity-40 ${
              view.onlineEnabled ? "border border-black/10 bg-white" : "bg-[#ff5e79] text-white"
            }`}
          >
            {view.onlineEnabled ? "Turn off online payments" : "Accept online payments"}
          </button>
          <p className="text-xs text-black/50">
            {view.onlineEnabled
              ? "Customers pay through the selected company. Try one small test payment after any change."
              : "While this is off, customers pay at the store and staff tap “Paid at the store”."}
          </p>
        </div>
      </section>
    </div>
  );
}
