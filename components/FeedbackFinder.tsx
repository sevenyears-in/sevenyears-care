"use client";

import { FormEvent, useState } from "react";
import { ErrorBox, inputClass, labelClass, phoneInputClass, primaryButtonClass } from "@/components/SiteChrome";

export function FeedbackFinder() {
  const [mobile, setMobile] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = await fetch("/api/feedback/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, number }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok || !data.url) {
      setBusy(false);
      setError(data.error || "Something went wrong. Please try again.");
      return;
    }
    window.location.assign(data.url);
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div>
        <label htmlFor="fb-mobile" className={labelClass}>
          Mobile number
        </label>
        <div className="flex">
          <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold text-black/60">
            +91
          </span>
          <input
            id="fb-mobile"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={10}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
            className={phoneInputClass}
            placeholder="10-digit mobile"
          />
        </div>
      </div>
      <div>
        <label htmlFor="fb-number" className={labelClass}>
          Bill, service or complaint number
        </label>
        <input
          id="fb-number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className={inputClass}
          placeholder="e.g. VDK26-SI1-8504 or SY-SRV-2026-123456"
        />
      </div>
      <ErrorBox message={error} />
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Finding…" : "Continue to feedback →"}
      </button>
    </form>
  );
}
