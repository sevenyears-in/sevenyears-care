"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { cardClass, ErrorBox, inputClass, labelClass, PageShell, phoneInputClass, primaryButtonClass } from "@/components/SiteChrome";
import { PasswordInput } from "@/components/PasswordInput";

export default function ForgotPasswordPage() {
  const [mobile, setMobile] = useState("");
  const [proof, setProof] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const r = await fetch("/api/account/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, proof, password }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) {
      setError(d.error || "Something went wrong. Please try again.");
      return;
    }
    setDone(true);
  };

  return (
    <PageShell eyebrow="My Account" title="Forgot password" intro="Set a new password using your mobile number and any number from your bill or a request.">
      <div className={cardClass}>
        {done ? (
          <div className="space-y-4">
            <p className="rounded-2xl bg-green-50 p-4 text-sm font-bold text-green-800">Your new password is saved. 🎉</p>
            <Link href="/account/login" className={`${primaryButtonClass} block text-center`}>
              Log in now
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="mobile" className={labelClass}>
                Mobile number
              </label>
              <div className="flex">
                <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold text-black/60">
                  +91
                </span>
                <input
                  id="mobile"
                  inputMode="numeric"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                  className={phoneInputClass}
                  placeholder="10-digit mobile"
                />
              </div>
            </div>
            <div>
              <label htmlFor="proof" className={labelClass}>
                Bill, warranty, service or complaint number
              </label>
              <input
                id="proof"
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                className={inputClass}
                placeholder="e.g. VDK26-SI1-8504, SY-WAR-…, SY-SRV-… or SY-CMP-…"
              />
              <p className="mt-2 text-xs text-black/50">Any one number registered with this mobile — it proves the account is yours.</p>
            </div>
            <div>
              <label htmlFor="password" className={labelClass}>
                New password
              </label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="At least 6 characters, letters and numbers"
              />
            </div>
            <ErrorBox message={error} />
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </div>
    </PageShell>
  );
}
