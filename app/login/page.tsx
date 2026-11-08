"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { ErrorBox, inputClass, labelClass, primaryButtonClass } from "@/components/SiteChrome";
import { PasswordInput } from "@/components/PasswordInput";

// One login for customers and staff (used by the mobile app).
export default function LoginPage() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (!userId.trim() || !password) return setError("Enter your User ID and password.");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Incorrect User ID or password.");
        setLoading(false);
        return;
      }
      window.location.assign(data.redirect || "/account");
    } catch {
      setError("Network problem. Please check your connection and try again.");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#f7f9fb] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Image src="/seven-years-logo-2026.png" alt="Seven Years" width={170} height={90} priority className="h-auto w-[170px]" />
        </div>
        <form onSubmit={submit} className="space-y-5 rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
          <div className="h-1.5 -mx-6 -mt-6 mb-5 rounded-t-3xl bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
          <h1 className="text-2xl font-bold">Login</h1>
          <label className="block">
            <span className={labelClass}>User ID</span>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Password</span>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={inputClass} />
          </label>
          <ErrorBox message={error} />
          <button type="submit" disabled={loading} className={`${primaryButtonClass} w-full disabled:opacity-50`}>
            {loading ? "Logging in…" : "Login"}
          </button>
          <p className="text-center text-xs">
            <Link href="/account/forgot" className="font-semibold text-[#0b7f90] underline">
              Forgot password?
            </Link>
          </p>
        </form>
        <div className="mt-6 grid grid-cols-2 gap-3 text-center text-sm font-semibold">
          <Link href="/request-service" className="rounded-2xl bg-white px-3 py-3 ring-1 ring-black/10">
            Request Service
          </Link>
          <Link href="/track-request" className="rounded-2xl bg-white px-3 py-3 ring-1 ring-black/10">
            Track Request
          </Link>
        </div>
      </div>
    </main>
  );
}
