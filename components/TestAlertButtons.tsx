"use client";

import { useState } from "react";

export function TestAlertButtons({ hasEmail, hasWhatsapp }: { hasEmail: boolean; hasWhatsapp: boolean }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const test = async (channel: "email" | "whatsapp") => {
    setBusy(channel);
    setMessage("");
    setError("");
    const response = await fetch("/api/staff/admin/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy("");
    if (response?.ok) setMessage(data.message ?? "Sent.");
    else setError(data.error ?? "Unable to send the test.");
  };

  return (
    <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <p className="font-bold">Send a test to yourself</p>
      <p className="mt-1 text-sm text-black/55">
        {hasEmail && hasWhatsapp
          ? "Uses the e-mail and WhatsApp number on your staff account."
          : "First add your own e-mail and WhatsApp number in Staff Users."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => test("email")} disabled={!!busy} className="rounded-xl bg-[#161616] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy === "email" ? "Sending..." : "Test e-mail"}
        </button>
        <button type="button" onClick={() => test("whatsapp")} disabled={!!busy} className="rounded-xl bg-[#25d366] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy === "whatsapp" ? "Sending..." : "Test WhatsApp"}
        </button>
      </div>
      {message && <p className="mt-3 text-sm font-semibold text-green-700">{message}</p>}
      {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
