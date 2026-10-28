"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass } from "@/components/SiteChrome";

// Small "track my request" box on the home page. Hands the details to
// /track-request, which looks the request up straight away.
export function HomeTrackForm() {
  const router = useRouter();
  const [ticket, setTicket] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const digits = mobile.replace(/\D/g, "");
    if (!ticket.trim()) return setError("Enter your request number.");
    if (!/^[6-9]\d{9}$/.test(digits)) return setError("Enter your 10-digit mobile number.");
    try {
      sessionStorage.setItem("sy_track", JSON.stringify({ ticket: ticket.trim(), mobile: digits }));
    } catch {
      // storage blocked — the track page will just ask again
    }
    router.push(`/track-request?ticket=${encodeURIComponent(ticket.trim().toUpperCase())}`);
  };

  return (
    <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
      <input
        aria-label="Request or complaint number"
        value={ticket}
        onChange={(e) => setTicket(e.target.value)}
        className={inputClass}
        placeholder="Request number, e.g. SY-SRV-2026-123456"
      />
      <input
        aria-label="Mobile number"
        type="tel"
        inputMode="numeric"
        maxLength={10}
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        className={inputClass}
        placeholder="10-digit mobile number"
      />
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      <button type="submit" className="w-full rounded-2xl bg-[#161616] px-5 py-3 font-bold text-white transition hover:opacity-90">
        Check status
      </button>
    </form>
  );
}
