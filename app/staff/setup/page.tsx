"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorBox, inputClass, labelClass, primaryButtonClass } from "@/components/SiteChrome";

export default function StaffSetupPage() {
  const router = useRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState("");

  const [fullName, setFullName] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [storeName, setStoreName] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch("/api/staff/setup");
        const data = await response.json();
        if (!response.ok) setCheckError(data.error || "Database not ready.");
        setAvailable(Boolean(data.setupAvailable));
      } catch {
        setCheckError("Unable to reach the server.");
        setAvailable(false);
      }
    };
    check();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (password !== confirm) {
      setErrorMessage("The two passwords don't match.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/staff/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, userId, password, storeName }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrorMessage(data.error || "Unable to complete setup.");
        return;
      }
      router.replace("/staff/admin/categories");
      router.refresh();
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fb] px-4 py-10 text-[#161616]">
      <div className="w-full max-w-md">
        <p className="text-center text-sm font-semibold text-[#ff5e79]">Seven Years Care</p>
        <h1 className="mt-1 text-center text-2xl font-bold">First-Time Setup</h1>
        <p className="mt-2 text-center text-sm text-black/60">
          Create the administrator account. The administrator adds the other staff.
        </p>

        <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
          {available === null ? (
            <p className="text-sm text-black/60">Checking...</p>
          ) : !available ? (
            <div className="space-y-4 text-sm">
              <ErrorBox message={checkError} />
              {!checkError && <p>Setup is already complete.</p>}
              <Link href="/staff/login" className="font-bold text-[#ff5e79]">
                Go to Staff Login →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="name" className={labelClass}>Your Name *</label>
                <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="uid" className={labelClass}>User ID *</label>
                <input id="uid" autoCapitalize="none" autoComplete="username" value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass} placeholder="e.g. admin" />
              </div>
              <div>
                <label htmlFor="store" className={labelClass}>Store Name</label>
                <input id="store" value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputClass} placeholder="Printed on certificates if Zoho doesn't give one" />
              </div>
              <div>
                <label htmlFor="pw" className={labelClass}>Password *</label>
                <input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="At least 8 characters, letters and numbers" />
              </div>
              <div>
                <label htmlFor="pw2" className={labelClass}>Confirm Password *</label>
                <input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
              </div>

              <ErrorBox message={errorMessage} />

              <button type="submit" disabled={saving} className={primaryButtonClass}>
                {saving ? "Creating..." : "Create Administrator"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
