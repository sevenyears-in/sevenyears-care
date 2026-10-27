"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import {
  cardClass,
  ErrorBox,
  inputClass,
  phoneInputClass,
  labelClass,
  primaryButtonClass,
} from "@/components/SiteChrome";
import { formatDateTime, todayISO } from "@/lib/helpers";
import { SERVICE_ISSUE_TYPES, SERVICE_MODES } from "@/lib/site-config";

type Created = {
  request_number: string;
  status: string;
  under_warranty: boolean;
  created_at: string;
};

export default function RequestServiceForm({
  initialWarrantyNumber,
}: {
  initialWarrantyNumber: string;
}) {
  const [mobileNumber, setMobileNumber] = useState("");
  const [warrantyNumber, setWarrantyNumber] = useState(initialWarrantyNumber);
  const [issueType, setIssueType] = useState("");
  const [description, setDescription] = useState("");
  const [serviceMode, setServiceMode] = useState("store_visit");
  const [preferredDate, setPreferredDate] = useState("");
  const [address, setAddress] = useState("");

  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationMessage, setLocationMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  const captureLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage("Location is not supported by this browser.");
      return;
    }

    setLocationMessage("Capturing current location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setLocationAccuracy(position.coords.accuracy);
        setLocationMessage(
          `Location captured (about ${Math.round(position.coords.accuracy)} m accuracy).`
        );
      },
      (error) => setLocationMessage(`Unable to capture location: ${error.message}`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const mobile = mobileNumber.replace(/\D/g, "");

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!warrantyNumber.trim()) {
      setErrorMessage("Please enter your warranty number.");
      return;
    }
    if (!issueType) {
      setErrorMessage("Please choose the type of problem.");
      return;
    }
    if (description.trim().length < 10) {
      setErrorMessage("Please describe the problem in a little more detail.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobileNumber: mobile,
          warrantyNumber,
          issueType,
          description,
          serviceMode,
          preferredDate: preferredDate || null,
          address,
          latitude,
          longitude,
          locationAccuracy,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(data.error || "Unable to create the service request.");
        return;
      }

      setCreated(data.request);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className={cardClass}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
          ✓
        </div>
        <h2 className="mt-6 text-2xl font-bold">Service request received</h2>
        <p className="mt-2 text-black/60">
          Our service team will contact you on +91 {mobileNumber.replace(/\D/g, "")}{" "}
          to arrange the next step.
        </p>

        <div className="mt-6 rounded-3xl bg-[#161616] p-6 text-white">
          <p className="text-xs uppercase tracking-wider text-white/50">Request Number</p>
          <p className="mt-2 text-2xl font-bold">{created.request_number}</p>
          <p className="mt-3 text-sm text-white/60">
            Raised on {formatDateTime(created.created_at)}
          </p>
        </div>

        {!created.under_warranty && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This product&apos;s warranty period has ended, so the repair may be
            chargeable. Our team will share the estimate before starting any work.
          </div>
        )}

        <p className="mt-5 text-sm text-black/60">
          Save your request number. You&apos;ll need it with your mobile number to
          track progress.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/track-request"
            className="rounded-2xl bg-[#ff5e79] px-6 py-3 text-center font-bold text-white"
          >
            Track This Request
          </Link>
          <Link
            href="/"
            className="rounded-2xl border border-black/10 px-6 py-3 text-center font-bold"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <form onSubmit={handleSubmit} className="space-y-8" noValidate>
        <section>
          <h2 className="text-lg font-bold">1. Your Warranty</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mobile" className={labelClass}>
                Registered Mobile Number *
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

            <div>
              <label htmlFor="warranty" className={labelClass}>
                Warranty Number *
              </label>
              <input
                id="warranty"
                type="text"
                value={warrantyNumber}
                onChange={(e) => setWarrantyNumber(e.target.value)}
                className={inputClass}
                placeholder="SY-WAR-2026-123456"
              />
            </div>
          </div>
          <p className="mt-3 text-sm text-black/50">
            Don&apos;t know your warranty number?{" "}
            <Link href="/my-warranties" className="font-bold text-[#ff5e79]">
              Find it in My Warranties
            </Link>
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold">2. The Problem</h2>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="issue" className={labelClass}>
                Type of Problem *
              </label>
              <select
                id="issue"
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className={inputClass}
              >
                <option value="">Select the problem</option>
                {SERVICE_ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="description" className={labelClass}>
                Describe the Problem *
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={1500}
                className={inputClass}
                placeholder="What happened, when did it start, and anything you've already tried."
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold">3. How Should We Help?</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SERVICE_MODES.map((mode) => (
              <label
                key={mode.value}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 text-sm font-semibold transition ${
                  serviceMode === mode.value
                    ? "border-[#ff5e79] bg-[#ff5e79]/5"
                    : "border-black/10 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="serviceMode"
                  value={mode.value}
                  checked={serviceMode === mode.value}
                  onChange={(e) => setServiceMode(e.target.value)}
                  className="accent-[#ff5e79]"
                />
                {mode.label}
              </label>
            ))}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="date" className={labelClass}>
                Preferred Date
              </label>
              <input
                id="date"
                type="date"
                value={preferredDate}
                min={todayISO()}
                onChange={(e) => setPreferredDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {serviceMode === "home_visit" && (
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="address" className={labelClass}>
                  Visit Address
                </label>
                <textarea
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className={inputClass}
                  placeholder="House name, street, area, landmark, PIN code"
                />
                <p className="mt-1 text-xs text-black/45">
                  Leave blank to use the address on your warranty.
                </p>
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">4. Your Location (optional)</h2>
          <div className="mt-4 rounded-2xl border border-dashed border-black/15 bg-[#fafafa] p-4">
            <p className="text-sm text-black/60">
              Sharing your current location helps us send the request to the nearest
              Seven Years service team{serviceMode === "home_visit" ? " and helps the technician find you" : ""}.
            </p>
            <button
              type="button"
              onClick={captureLocation}
              className="mt-3 rounded-2xl bg-[#11b8d0] px-5 py-3 text-sm font-bold text-white"
            >
              {latitude !== null && longitude !== null
                ? "Update Current Location"
                : "Use Current Location"}
            </button>
            {locationMessage && (
              <p className="mt-3 text-sm text-black/60">{locationMessage}</p>
            )}
          </div>
        </section>

        <ErrorBox message={errorMessage} />

        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? "Submitting..." : "Submit Service Request"}
        </button>
      </form>
    </div>
  );
}
