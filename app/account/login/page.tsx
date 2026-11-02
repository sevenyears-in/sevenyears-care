"use client";

import { FormEvent, useState } from "react";
import {
  cardClass,
  ErrorBox,
  inputClass,
  labelClass,
  PageShell,
  phoneInputClass,
  primaryButtonClass,
} from "@/components/SiteChrome";

export default function CustomerLoginPage() {
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const digits = mobile.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError("Please enter your 10-digit mobile number.");
      return;
    }
    if (!password.trim()) {
      setError("Please enter your password.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: digits, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Unable to log in.");
        setLoading(false);
        return;
      }
      // Full page load so the new login is picked up straight away.
      window.location.assign("/account");
    } catch {
      setError("Network problem. Please check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <PageShell
      title="My Account"
      intro="See your warranties, service requests and complaints in one place. Your User ID is your mobile number. Your first password is the last 4 digits of your bill number."
    >
      <form onSubmit={submit} className={`${cardClass} space-y-5`}>
        <div>
          <label htmlFor="mobile" className={labelClass}>Mobile number (User ID)</label>
          <div className="flex">
            <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold text-black/60">
              +91
            </span>
            <input
              id="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className={phoneInputClass}
              placeholder="10-digit mobile"
            />
          </div>
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="e.g. last 4 digits of your bill number"
          />
          <p className="mt-2 text-xs text-black/50">
            Bill VDK26-SI1-8504 → first password 8504. Forgot a password you changed? Contact your Seven Years store.
          </p>
        </div>
        <ErrorBox message={error} />
        <button type="submit" disabled={loading} className={primaryButtonClass}>
          {loading ? "Logging in..." : "Log In"}
        </button>
      </form>
    </PageShell>
  );
}
