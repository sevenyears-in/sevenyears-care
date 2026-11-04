"use client";

import { useState } from "react";
import { ErrorBox, inputClass, primaryButtonClass } from "@/components/SiteChrome";

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };

function loadCheckout(): Promise<RazorpayCtor | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) return resolve(w.Razorpay);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve((window as unknown as { Razorpay?: RazorpayCtor }).Razorpay ?? null);
    script.onerror = () => resolve(null);
    document.body.appendChild(script);
  });
}

export function ExtendPanel({
  token,
  mode,
  approved,
  online,
  priceLabel,
  directUntil,
  windowDays,
  gatewayLabel = "Razorpay",
}: {
  token: string;
  mode: "pay" | "inspection";
  approved: boolean;
  online: boolean;
  priceLabel: string;
  directUntil: string;
  windowDays: number;
  gatewayLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [note, setNote] = useState("");

  const pay = async () => {
    setError("");
    setBusy(true);
    const res = await fetch("/api/extend/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const order = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setBusy(false);
      setError(order.error || "Unable to start the payment.");
      return;
    }
    // Paytm / ICICI: go to the bank's own payment page; it sends the customer back here.
    if (order.provider === "paytm") {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = order.action;
      for (const [k, v] of Object.entries(order.fields as Record<string, string>)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = v;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      return;
    }
    if (order.provider === "icici") {
      window.location.assign(order.url);
      return;
    }

    const Razorpay = await loadCheckout();
    if (!Razorpay) {
      setBusy(false);
      setError("The payment window could not load. Check your internet and try again.");
      return;
    }
    const checkout = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: "INR",
      name: order.name,
      description: order.description,
      prefill: order.prefill,
      theme: { color: "#ff5e79" },
      modal: { ondismiss: () => setBusy(false) },
      handler: async (r: RazorpayResponse) => {
        const v = await fetch("/api/extend/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, ...r }),
        }).catch(() => null);
        const data = v ? await v.json().catch(() => ({})) : {};
        setBusy(false);
        if (!v?.ok) {
          setError(data.error || "We couldn't confirm the payment. If money was deducted, contact the store.");
          return;
        }
        setDone("Payment received — your extended warranty is active! 🎉 Opening your updated certificate…");
        setTimeout(() => window.location.assign(`/warranty/${token}`), 2500);
      },
    });
    checkout.on("payment.failed", () => {
      setBusy(false);
      setError("The payment did not go through. No money was taken — please try again.");
    });
    checkout.open();
  };

  const requestInspection = async () => {
    setError("");
    setBusy(true);
    const res = await fetch("/api/extend/inspection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, note }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(data.error || "Unable to send the request.");
      return;
    }
    setDone("Request sent! Our technician will contact you to check the product. Once approved, you can pay here.");
    setTimeout(() => window.location.reload(), 3000);
  };

  if (done) {
    return <p className="rounded-2xl bg-green-50 p-4 text-sm font-bold text-green-800 ring-1 ring-green-200">{done}</p>;
  }

  if (mode === "pay") {
    return (
      <div className="space-y-3">
        {approved ? (
          <p className="rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">
            ✓ Inspection approved — you can buy the extended warranty now.
          </p>
        ) : (
          <p className="text-sm text-black/60">Buy it within {windowDays} days of purchase (until {directUntil}) — no inspection needed.</p>
        )}
        {online ? (
          <button type="button" disabled={busy} onClick={pay} className={primaryButtonClass}>
            {busy ? "Opening secure payment…" : `Pay ${priceLabel} online`}
          </button>
        ) : (
          <p className="rounded-2xl bg-[#f7f9fb] p-4 text-sm font-semibold text-black/70">
            Online payment is coming soon. Please pay {priceLabel} at any Seven Years store — staff will add it to your warranty.
          </p>
        )}
        <p className="text-center text-xs text-black/40">UPI · Cards · Net banking — secure payment by {gatewayLabel}</p>
        <ErrorBox message={error} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-black/65">
        It is more than {windowDays} days since purchase, so our technician needs to check the product first (free). After
        approval you can pay {priceLabel} online.
      </p>
      <textarea
        rows={2}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={inputClass}
        placeholder="Anything we should know? Best time to visit / bring it to the store (optional)"
      />
      <button type="button" disabled={busy} onClick={requestInspection} className={primaryButtonClass}>
        {busy ? "Sending…" : "Request inspection"}
      </button>
      <ErrorBox message={error} />
    </div>
  );
}
