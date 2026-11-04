"use client";

import { useEffect, useState } from "react";
import { ErrorBox, inputClass, labelClass } from "@/components/SiteChrome";

type View = {
  price: number;
  months: number;
  windowDays: number;
  onlineEnabled: boolean;
  razorpayKeyId: string;
  keySecretSet: boolean;
  webhookSecretSet: boolean;
  testMode: boolean;
  webhookUrl: string;
};

const card = "soft-card rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-6";

export default function ExtendedWarrantySettingsPage() {
  const [view, setView] = useState<View | null>(null);
  const [price, setPrice] = useState("");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch("/api/staff/admin/extended-warranty")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Unable to load.");
        setView(d);
        setPrice(String(d.price));
        setKeyId(d.razorpayKeyId);
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
    setView(d);
    setKeySecret("");
    setWebhookSecret("");
    setNotice(ok);
  };

  if (!view) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Extended Warranty</h1>
        {error ? <ErrorBox message={error} /> : <p className="text-sm text-black/55">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Extended Warranty</h1>
        <p className="mt-2 text-sm text-black/60">
          +{view.months} months on top of the standard warranty. Within {view.windowDays} days of purchase customers can buy it
          online straight away; later, a technician inspects the product first.
        </p>
      </div>

      {notice && <p className="rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">{notice}</p>}
      <ErrorBox message={error} />

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
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              className={`${inputClass} w-40`}
            />
          </div>
          <button
            type="button"
            disabled={busy || !price || Number(price) === view.price}
            onClick={() => save({ price: Number(price) }, `Price saved: ₹${Number(price).toLocaleString("en-IN")}.`)}
            className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
          >
            Save price
          </button>
        </div>
        <p className="mt-2 text-xs text-black/50">
          Used everywhere at once: billing (Register Warranty), the customer&apos;s online payment and the certificate.
          Requests already approved keep the price they were approved at.
        </p>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">2. Online payment (Razorpay)</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              view.onlineEnabled ? "bg-green-50 text-green-700 ring-1 ring-green-200" : "bg-black/5 text-black/55"
            }`}
          >
            {view.onlineEnabled ? (view.testMode ? "ON · TEST MODE" : "ON") : "OFF"}
          </span>
        </div>

        <details className="mt-4 rounded-2xl bg-[#f7f9fb] p-4 text-sm leading-6">
          <summary className="cursor-pointer font-bold">How to get the Razorpay keys (step by step)</summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-black/70">
            <li>
              Go to <b>razorpay.com</b> → <b>Sign up</b> with the business e-mail and mobile. Complete KYC (PAN, GST,
              bank account) — approval usually takes 1–3 working days.
            </li>
            <li>
              In the Razorpay Dashboard, open <b>Account &amp; Settings → API Keys</b> → <b>Generate Key</b>. Choose{" "}
              <b>Live mode</b> (top switch) for real payments, or <b>Test mode</b> to try it first.
            </li>
            <li>
              Copy the <b>Key ID</b> (starts with <code>rzp_live_</code>) and the <b>Key Secret</b> (shown only once) and paste
              them below.
            </li>
            <li>
              Open <b>Account &amp; Settings → Webhooks → Add New Webhook</b>. Webhook URL: the address below. Create your own
              <b> Secret</b> (any long password) and tick the events <b>payment.captured</b> and <b>order.paid</b>. Paste the
              same secret below.
            </li>
            <li>Turn on <b>Accept online payments</b>. Try one payment in Test mode before switching to Live keys.</li>
          </ol>
        </details>

        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="keyId" className={labelClass}>
              Key ID
            </label>
            <input id="keyId" value={keyId} onChange={(e) => setKeyId(e.target.value)} className={inputClass} placeholder="rzp_live_…" />
          </div>
          <div>
            <label htmlFor="keySecret" className={labelClass}>
              Key Secret {view.keySecretSet && <span className="font-normal text-green-700">(saved — leave blank to keep)</span>}
            </label>
            <input
              id="keySecret"
              type="password"
              autoComplete="off"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              className={inputClass}
              placeholder={view.keySecretSet ? "••••••••" : "Paste the Key Secret"}
            />
          </div>
          <div>
            <label className={labelClass}>Webhook URL (paste this into Razorpay)</label>
            <div className="flex gap-2">
              <input readOnly value={view.webhookUrl} className={`${inputClass} font-mono text-xs`} />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(view.webhookUrl).then(() => setNotice("Webhook URL copied."))}
                className="shrink-0 rounded-2xl border border-black/10 px-4 text-sm font-bold"
              >
                Copy
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="webhookSecret" className={labelClass}>
              Webhook Secret {view.webhookSecretSet && <span className="font-normal text-green-700">(saved — leave blank to keep)</span>}
            </label>
            <input
              id="webhookSecret"
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              className={inputClass}
              placeholder={view.webhookSecretSet ? "••••••••" : "The same secret you typed in Razorpay"}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                save(
                  { razorpayKeyId: keyId, razorpayKeySecret: keySecret, razorpayWebhookSecret: webhookSecret },
                  "Razorpay details saved."
                )
              }
              className="rounded-2xl bg-[#161616] px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              Save Razorpay details
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                save(
                  { onlineEnabled: !view.onlineEnabled },
                  view.onlineEnabled ? "Online payments turned off." : "Online payments turned on."
                )
              }
              className={`rounded-2xl px-5 py-3 text-sm font-bold disabled:opacity-40 ${
                view.onlineEnabled ? "border border-black/10 bg-white" : "bg-[#ff5e79] text-white"
              }`}
            >
              {view.onlineEnabled ? "Turn off online payments" : "Accept online payments"}
            </button>
          </div>
          {!view.onlineEnabled && (
            <p className="text-xs text-black/50">
              While this is off, customers can still request the inspection; they pay at the store and staff tap “Paid at the
              store”.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
