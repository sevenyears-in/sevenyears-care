"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  cardClass,
  ErrorBox,
  inputClass,
  phoneInputClass,
  labelClass,
  PageShell,
  primaryButtonClass,
} from "@/components/SiteChrome";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";

type Created = {
  complaint_number: string;
  status: string;
  created_at: string;
  staff_name: string | null;
  store_name: string | null;
};

type Me = {
  loggedIn: boolean;
  mobile?: string;
  name?: string;
  email?: string;
  warranties?: { warrantyNumber: string; billNumber: string; billDate: string; productName: string; storeName: string | null }[];
};

const OTHER = "__other__";

export default function RegisterComplaintPage() {
  const [me, setMe] = useState<Me | null>(null);

  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [billChoice, setBillChoice] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [newAccount, setNewAccount] = useState(false);

  // Logged in to My Account? Fill in their details and list their bills.
  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/account/me", { cache: "no-store" }).catch(() => null);
      const data: Me = response ? await response.json().catch(() => ({ loggedIn: false })) : { loggedIn: false };
      setMe(data);
      if (data.loggedIn) {
        setFullName(data.name ?? "");
        setMobileNumber(data.mobile ?? "");
        setEmail(data.email ?? "");
        const first = data.warranties?.[0];
        if (first) setBillChoice(first.billNumber);
      }
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref) {
        const known = data.warranties?.find((w) => w.billNumber === ref || w.warrantyNumber === ref);
        if (known) setBillChoice(known.billNumber);
        else {
          setBillChoice(OTHER);
          setReference(ref);
        }
      }
    };
    load();
  }, []);

  const loggedIn = Boolean(me?.loggedIn);
  const bills = [...new Map((me?.warranties ?? []).map((w) => [w.billNumber, w])).values()];
  const usingList = loggedIn && bills.length > 0 && billChoice !== OTHER;
  const finalReference = usingList ? billChoice : reference;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const mobile = mobileNumber.replace(/\D/g, "");

    if (!fullName.trim()) {
      setErrorMessage("Please enter your name.");
      return;
    }
    if (!loggedIn && !/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!finalReference.trim()) {
      setErrorMessage("Please enter the invoice (bill) number or warranty number.");
      return;
    }
    if (!category) {
      setErrorMessage("Please choose what the complaint is about.");
      return;
    }
    if (description.trim().length < 10) {
      setErrorMessage("Please describe the issue in a little more detail.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          mobileNumber: mobile,
          email,
          category,
          reference: finalReference,
          description,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to register the complaint.");
        return;
      }

      setCreated(data.complaint);
      setNewAccount(Boolean(data.account?.created));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell
      title="Register Complaint"
      intro="We're sorry something went wrong. Tell us what happened and the Seven Years team will look into it."
    >
      {created ? (
        <div className={cardClass}>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
          <h2 className="mt-6 text-2xl font-bold">Complaint registered</h2>
          <p className="mt-2 text-black/60">
            Thank you for letting us know. Our team will contact you within 2 working hours.
          </p>

          <div className="mt-6 rounded-3xl bg-[#161616] p-6 text-white">
            <p className="text-xs uppercase tracking-wider text-white/50">Complaint Number</p>
            <p className="mt-2 text-2xl font-bold">{created.complaint_number}</p>
            <p className="mt-3 text-sm text-white/60">Registered on {formatDateTime(created.created_at)}</p>
            {(created.store_name || created.staff_name) && (
              <p className="mt-2 text-sm text-white/80">
                {created.store_name ? `Store: ${created.store_name}` : ""}
                {created.store_name && created.staff_name ? " · " : ""}
                {created.staff_name ? `Staff: ${created.staff_name}` : ""}
              </p>
            )}
          </div>

          {newAccount && (
            <div className="mt-5 rounded-2xl border border-[#11b8d0]/30 bg-[#11b8d0]/5 p-4 text-sm">
              <p className="font-bold">Your My Account login is ready</p>
              <p className="mt-1 text-black/70">
                User ID: your mobile number <span className="font-mono">{mobileNumber.replace(/\D/g, "")}</span>. Password: the{" "}
                <b>last 4 digits of your mobile number</b>. Log in to follow this complaint and see your warranties. You can
                change the password after logging in.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {loggedIn || newAccount ? (
              <Link href="/account" className="rounded-2xl bg-[#ff5e79] px-6 py-3 text-center font-bold text-white">
                Go to My Account
              </Link>
            ) : (
              <Link
                href={`/track-request?ticket=${encodeURIComponent(created.complaint_number)}`}
                className="rounded-2xl bg-[#ff5e79] px-6 py-3 text-center font-bold text-white"
              >
                Track This Complaint
              </Link>
            )}
            <Link href="/" className="rounded-2xl border border-black/10 px-6 py-3 text-center font-bold">
              Back to Home
            </Link>
          </div>
        </div>
      ) : (
        <div className={cardClass}>
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            <section>
              <h2 className="text-lg font-bold">1. Your Details</h2>
              {loggedIn ? (
                <div className="mt-4 rounded-2xl bg-[#f7f9fb] p-4 text-sm">
                  <p className="font-bold">{fullName || "Customer"}</p>
                  <p className="text-black/60">+91 {mobileNumber}{email ? ` · ${email}` : ""}</p>
                  <p className="mt-1 text-xs text-black/45">From your My Account login.</p>
                </div>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="name" className={labelClass}>Full Name *</label>
                    <input id="name" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} placeholder="Your name" />
                  </div>
                  <div>
                    <label htmlFor="mobile" className={labelClass}>Mobile Number *</label>
                    <div className="flex">
                      <div className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">+91</div>
                      <input id="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} maxLength={10} className={phoneInputClass} placeholder="10-digit mobile number" />
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="email" className={labelClass}>Email</label>
                    <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="Optional" />
                  </div>
                  <p className="text-xs text-black/50 sm:col-span-2">
                    Already have a login?{" "}
                    <Link href="/account/login" className="font-bold text-[#ff5e79]">Log in to My Account</Link> and your details are filled in for you.
                  </p>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-lg font-bold">2. About the Complaint</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="reference" className={labelClass}>Invoice or Warranty Number *</label>
                  {loggedIn && bills.length > 0 && (
                    <select id="bill" value={billChoice} onChange={(e) => setBillChoice(e.target.value)} className={`${inputClass} mb-3`}>
                      {bills.map((w) => (
                        <option key={w.billNumber} value={w.billNumber}>
                          {w.billNumber} · {formatDate(w.billDate)} · {w.productName}
                          {w.storeName ? ` · ${w.storeName}` : ""}
                        </option>
                      ))}
                      <option value={OTHER}>Another bill (type the number)</option>
                    </select>
                  )}
                  {!usingList && (
                    <input
                      id="reference"
                      type="text"
                      value={reference}
                      onChange={(e) => setReference(e.target.value.toUpperCase())}
                      className={inputClass}
                      placeholder="e.g. VDK26-SI1-8504 or SY-WAR-2026-123456"
                    />
                  )}
                  <p className="mt-1 text-xs text-black/50">
                    Printed at the top of your bill. It tells us the store and the staff who served you.
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="category" className={labelClass}>Complaint About *</label>
                  <select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
                    <option value="">Select a category</option>
                    {COMPLAINT_CATEGORIES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="description" className={labelClass}>What Happened? *</label>
                  <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={2000} className={inputClass} placeholder="Please share as much detail as you can." />
                </div>
              </div>
            </section>

            <ErrorBox message={errorMessage} />

            <button type="submit" disabled={submitting || me === null} className={primaryButtonClass}>
              {submitting ? "Submitting..." : "Submit Complaint"}
            </button>
          </form>
        </div>
      )}
    </PageShell>
  );
}
