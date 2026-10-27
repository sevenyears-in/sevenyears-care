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
import { supabase } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/helpers";
import { COMPLAINT_CATEGORIES } from "@/lib/site-config";

type Store = { id: string; store_name: string };
type Created = { complaint_number: string; status: string; created_at: string };

export default function RegisterComplaintPage() {
  const [stores, setStores] = useState<Store[]>([]);

  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");
  const [storeId, setStoreId] = useState("");
  const [category, setCategory] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    const loadStores = async () => {
      const { data } = await supabase
        .from("stores")
        .select("id, store_name")
        .eq("is_active", true)
        .order("store_name");
      setStores(data ?? []);
    };
    loadStores();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const mobile = mobileNumber.replace(/\D/g, "");

    if (!fullName.trim()) {
      setErrorMessage("Please enter your name.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage("Please enter a valid 10-digit mobile number.");
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
          storeId: storeId || null,
          category,
          reference,
          description,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to register the complaint.");
        return;
      }

      setCreated(data.complaint);
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
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
            ✓
          </div>
          <h2 className="mt-6 text-2xl font-bold">Complaint registered</h2>
          <p className="mt-2 text-black/60">
            Thank you for letting us know. Our team will review it and contact you.
          </p>

          <div className="mt-6 rounded-3xl bg-[#161616] p-6 text-white">
            <p className="text-xs uppercase tracking-wider text-white/50">
              Complaint Number
            </p>
            <p className="mt-2 text-2xl font-bold">{created.complaint_number}</p>
            <p className="mt-3 text-sm text-white/60">
              Registered on {formatDateTime(created.created_at)}
            </p>
          </div>

          <p className="mt-5 text-sm text-black/60">
            Save your complaint number. You&apos;ll need it with your mobile number
            to track progress.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/track-request"
              className="rounded-2xl bg-[#ff5e79] px-6 py-3 text-center font-bold text-white"
            >
              Track This Complaint
            </Link>
            <Link
              href="/"
              className="rounded-2xl border border-black/10 px-6 py-3 text-center font-bold"
            >
              Back to Home
            </Link>
          </div>
        </div>
      ) : (
        <div className={cardClass}>
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            <section>
              <h2 className="text-lg font-bold">1. Your Details</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className={labelClass}>
                    Full Name *
                  </label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={inputClass}
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label htmlFor="mobile" className={labelClass}>
                    Mobile Number *
                  </label>
                  <div className="flex">
                    <div className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">
                      +91
                    </div>
                    <input
                      id="mobile"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(e.target.value)}
                      maxLength={10}
                      className={phoneInputClass}
                      placeholder="10-digit mobile number"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="email" className={labelClass}>
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="Optional"
                  />
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-lg font-bold">2. About the Complaint</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="category" className={labelClass}>
                    Complaint About *
                  </label>
                  <select
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select a category</option>
                    {COMPLAINT_CATEGORIES.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="store" className={labelClass}>
                    Seven Years Location
                  </label>
                  <select
                    id="store"
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select location (optional)</option>
                    {stores.map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.store_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="reference" className={labelClass}>
                    Invoice or Warranty Number
                  </label>
                  <input
                    id="reference"
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className={inputClass}
                    placeholder="Optional — helps us find your purchase faster"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="description" className={labelClass}>
                    What Happened? *
                  </label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    maxLength={2000}
                    className={inputClass}
                    placeholder="Please share as much detail as you can."
                  />
                </div>
              </div>
            </section>

            <ErrorBox message={errorMessage} />

            <button type="submit" disabled={submitting} className={primaryButtonClass}>
              {submitting ? "Submitting..." : "Submit Complaint"}
            </button>
          </form>
        </div>
      )}
    </PageShell>
  );
}
