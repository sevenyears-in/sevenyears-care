"use client";

import { useState } from "react";

export function ResetCustomerLogin({
  warrantyId,
  ticketType,
  ticketId,
}: {
  warrantyId?: string;
  ticketType?: "service" | "complaint";
  ticketId?: string;
}) {
  const fromTicket = Boolean(ticketId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reset = async () => {
    if (
      !window.confirm(
        fromTicket
          ? "Reset this customer's login password to the last 4 digits of their mobile number?"
          : "Reset this customer's login password to the last 4 digits of this bill number?"
      )
    )
      return;
    setBusy(true);
    setMessage("");
    setError("");
    const response = await fetch("/api/staff/customer-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fromTicket ? { ticketType, ticketId } : { warrantyId }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (response?.ok) setMessage(data.message ?? "Done.");
    else setError(data.error ?? "Unable to reset.");
  };

  return (
    <div className="rounded-3xl bg-white p-5 text-sm soft-card ring-1 ring-black/5">
      <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Customer login</p>
      <p className="mt-2 text-black/60">
        User ID is the customer&apos;s mobile number. If they forgot their password, reset it to the last 4 digits of{" "}
        {fromTicket ? "their mobile number" : "this bill number"} — or ask them to use “Forgot password?” on the login page.
      </p>
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="mt-3 rounded-xl border border-black/10 px-4 py-2 text-xs font-bold hover:bg-[#f7f9fb] disabled:opacity-50"
      >
        {busy ? "Resetting..." : "Reset customer password"}
      </button>
      {message && <p className="mt-3 font-semibold text-green-700">{message}</p>}
      {error && <p className="mt-3 font-semibold text-red-700">{error}</p>}
    </div>
  );
}
