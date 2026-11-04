"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { cardClass, ErrorBox, inputClass, labelClass, PageShell, primaryButtonClass } from "@/components/SiteChrome";
import { PasswordInput } from "@/components/PasswordInput";

export default function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);
    if (response?.status === 401) {
      window.location.assign("/account/login");
      return;
    }
    if (!response?.ok) {
      setError(data.error || "Unable to change the password.");
      return;
    }
    setDone(true);
  };

  return (
    <PageShell eyebrow="My Account" title="Change Password" intro="Choose a password with at least 6 characters, using letters and numbers.">
      {done ? (
        <div className={cardClass}>
          <p className="font-bold text-green-700">Your password has been changed.</p>
          <Link href="/account" className="mt-4 inline-block font-bold text-[#ff5e79]">
            ← Back to My Account
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className={`${cardClass} space-y-5`}>
          <div>
            <label htmlFor="cur" className={labelClass}>Current password</label>
            <PasswordInput id="cur" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="new" className={labelClass}>New password</label>
            <PasswordInput id="new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="confirm" className={labelClass}>New password again</label>
            <PasswordInput id="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </div>
          <ErrorBox message={error} />
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? "Saving..." : "Change Password"}
          </button>
          <Link href="/account" className="block text-center text-sm font-semibold text-black/50">Cancel</Link>
        </form>
      )}
    </PageShell>
  );
}
