"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorBox, inputClass, labelClass, primaryButtonClass } from "@/components/SiteChrome";

export default function StaffLoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [setupAvailable, setSetupAvailable] = useState(false);

  useEffect(() => {
    const check = async () => {
      const response = await fetch("/api/staff/setup").catch(() => null);
      const data = await response?.json().catch(() => null);
      if (data?.setupAvailable) setSetupAvailable(true);
    };
    check();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (!userId.trim() || !password) {
      setErrorMessage("Enter your User ID and password.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to log in.");
        return;
      }

      router.replace("/staff");
      router.refresh();
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f9fb] px-4 py-10 text-[#161616]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/seven-years-logo.png"
            alt="Seven Years"
            width={180}
            height={70}
            className="h-auto w-[160px]"
            priority
          />
          <p className="mt-5 text-sm font-semibold text-[#ff5e79]">Seven Years Care</p>
          <h1 className="mt-1 text-2xl font-bold">Staff Login</h1>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
          {setupAvailable && (
            <div className="mb-5 rounded-2xl border border-[#11b8d0]/30 bg-[#11b8d0]/5 p-4 text-sm">
              <p className="font-bold">First time here?</p>
              <p className="mt-1 text-black/60">No staff accounts exist yet.</p>
              <Link href="/staff/setup" className="mt-2 inline-block font-bold text-[#11b8d0]">
                Create the administrator account →
              </Link>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="userId" className={labelClass}>
                User ID
              </label>
              <input
                id="userId"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className={labelClass}>
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            <ErrorBox message={errorMessage} />

            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? "Logging in..." : "Log In"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-black/50">
          <Link href="/" className="font-semibold hover:text-black">
            ← Customer portal
          </Link>
        </p>
      </div>
    </main>
  );
}
