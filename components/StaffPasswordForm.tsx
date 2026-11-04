"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ErrorBox, inputClass, labelClass, primaryButtonClass } from "@/components/SiteChrome";
import { PasswordInput } from "@/components/PasswordInput";

export function StaffPasswordForm({ canCancel }: { canCancel: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/staff/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (response?.status === 401) {
      window.location.assign("/staff/login");
      return;
    }
    if (!response?.ok) {
      setBusy(false);
      setError(data.error ?? "Unable to change the password.");
      return;
    }
    window.location.assign("/staff");
  };

  return (
    <form onSubmit={submit} className="mt-5 space-y-5 rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
      <div>
        <label htmlFor="cur" className={labelClass}>Current password</label>
        <PasswordInput id="cur" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="new" className={labelClass}>New password</label>
        <PasswordInput id="new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        <p className="mt-1 text-xs text-black/50">At least 8 characters, with letters and numbers.</p>
      </div>
      <div>
        <label htmlFor="confirm" className={labelClass}>New password again</label>
        <PasswordInput id="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
      </div>
      <ErrorBox message={error} />
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "Saving..." : "Change Password"}
      </button>
      {canCancel && (
        <Link href="/staff" className="block text-center text-sm font-semibold text-black/50">
          Cancel
        </Link>
      )}
    </form>
  );
}
