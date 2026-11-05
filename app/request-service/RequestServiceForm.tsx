"use client";

import { FormEvent, useEffect, useState } from "react";
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
import { PHOTO_OPTIONAL_ISSUES, PHOTO_REQUIRED_ISSUES, SERVICE_ISSUE_TYPES, SERVICE_MODES } from "@/lib/site-config";
import { PhotoPicker, uploadPhotos, type PickedPhoto } from "@/components/PhotoPicker";

type LookupItem = {
  warrantyNumber: string;
  productName: string;
  model: string;
  serialEnd: string;
  store: string | null;
  active: boolean;
  underWarranty: boolean;
};

type Created = {
  request_number: string;
  status: string;
  under_warranty: boolean;
  created_at: string;
  priority?: string;
};

export default function RequestServiceForm({
  initialWarrantyNumber,
}: {
  initialWarrantyNumber: string;
}) {
  const [mobileNumber, setMobileNumber] = useState("");
  const [contactName, setContactName] = useState("");
  const [altName, setAltName] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [warrantyNumber, setWarrantyNumber] = useState(initialWarrantyNumber);
  // Find the product: mobile number (buyer's or the product user's) + bill or warranty number.
  const [reference, setReference] = useState(initialWarrantyNumber);
  const [lookupMobile, setLookupMobile] = useState("");
  const [items, setItems] = useState<LookupItem[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [useOther, setUseOther] = useState(false);
  const [issueType, setIssueType] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const photosRequired = PHOTO_REQUIRED_ISSUES.includes(issueType);
  const photosAllowed = photosRequired || PHOTO_OPTIONAL_ISSUES.includes(issueType);
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
  const [newAccount, setNewAccount] = useState(false);
  const [me, setMe] = useState<{
    loggedIn: boolean;
    name?: string;
    mobile?: string;
    warranties?: { warrantyNumber: string; productName: string; serialNumber: string; billNumber: string; active: boolean }[];
  } | null>(null);

  // Logged in to My Account? Fill in the mobile number and list their warranties.
  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/account/me", { cache: "no-store" }).catch(() => null);
      const data = response ? await response.json().catch(() => ({ loggedIn: false })) : { loggedIn: false };
      setMe(data);
      if (data.loggedIn) {
        setMobileNumber(data.mobile ?? "");
        setContactName(data.name ?? "");
        const list = (data.warranties ?? []) as { warrantyNumber: string; active: boolean }[];
        const chosen = list.find((w) => w.warrantyNumber === initialWarrantyNumber) ?? list.find((w) => w.active) ?? list[0];
        if (chosen) setWarrantyNumber(chosen.warrantyNumber);
      }
    };
    load();
  }, [initialWarrantyNumber]);

  const loggedIn = Boolean(me?.loggedIn);
  const myWarranties = me?.warranties ?? [];
  const pickFromAccount = loggedIn && myWarranties.length > 0 && !useOther;

  const lookup = async () => {
    setLookupError("");
    setItems(null);
    setWarrantyNumber("");
    const ownerMobile = lookupMobile.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(ownerMobile)) {
      setLookupError("Enter your registered 10-digit mobile number.");
      return;
    }
    if (reference.trim().length < 4) {
      setLookupError("Enter the bill number or warranty number.");
      return;
    }
    setLookupBusy(true);
    const r = await fetch("/api/service-requests/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, mobile: ownerMobile }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setLookupBusy(false);
    if (!r?.ok) {
      setLookupError(d.error || "Unable to find this bill.");
      return;
    }
    const list = (d.items ?? []) as LookupItem[];
    setItems(list);
    const usable = list.filter((i) => i.active);
    if (usable.length === 1) setWarrantyNumber(usable[0].warrantyNumber);
    setMobileNumber((m) => m || ownerMobile); // usually the same person to contact
  };


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

    if (!warrantyNumber.trim()) {
      setErrorMessage("Enter the bill or warranty number, tap Find and choose the product.");
      return;
    }
    if (!contactName.trim()) {
      setErrorMessage("Please enter the name of the person we should contact.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setErrorMessage("Please enter a valid 10-digit mobile number to contact.");
      return;
    }
    const alt = altMobile.replace(/\D/g, "");
    if (alt && !/^[6-9]\d{9}$/.test(alt)) {
      setErrorMessage("The alternate mobile number is not valid.");
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
    if (photosRequired && photos.length < 3) {
      setErrorMessage("Please add 3 photos of the product from different angles.");
      return;
    }

    setSubmitting(true);

    try {
      let photoPaths: string[] = [];
      if (photosAllowed && photos.length) {
        try {
          photoPaths = await uploadPhotos(photos);
        } catch (e) {
          setErrorMessage(e instanceof Error ? e.message : "A photo could not be uploaded. Please try again.");
          return;
        }
      }
      const response = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactMobile: mobile,
          contactName,
          altName,
          altMobile: altMobile.replace(/\D/g, ""),
          warrantyNumber,
          ownerMobile: lookupMobile.replace(/\D/g, ""),
          issueType,
          photos: photoPaths,
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
      setNewAccount(Boolean(data.account?.created));
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
          within 2 working hours to arrange the next step.
        </p>

        {created.priority === "safety" && (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            For your child&apos;s safety, please stop using this product until our team has checked it.
            We have marked your request as urgent.
          </div>
        )}

        <div className="mt-6 rounded-3xl bg-[#161616] p-6 text-white">
          <p className="text-xs uppercase tracking-wider text-white/50">Request Number</p>
          <p className="mt-2 text-2xl font-bold">{created.request_number}</p>
          <p className="mt-3 text-sm text-white/60">
            Raised on {formatDateTime(created.created_at)}
          </p>
        </div>

        {newAccount && (
          <div className="mt-5 rounded-2xl border border-[#11b8d0]/30 bg-[#11b8d0]/5 p-4 text-sm">
            <p className="font-bold">Your My Account login is ready</p>
            <p className="mt-1 text-black/70">
              User ID: your mobile number. Password: the <b>last 4 digits of your mobile number</b>. Log in at My Account
              to follow this request and see your warranties. You can change the password after logging in.
            </p>
          </div>
        )}

        {!created.under_warranty && (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            This product&apos;s warranty period has ended, so the repair may be
            chargeable. Our team will share the estimate before starting any work.
          </div>
        )}

        <p className="mt-5 text-sm text-black/60">
          Save your request number. You&apos;ll need it with your mobile number to
          track progress. If someone else bought this product, they also get a copy of this request.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/track-request?ticket=${encodeURIComponent(created.request_number)}`}
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
          <h2 className="text-lg font-bold">1. The Product</h2>
          {pickFromAccount ? (
            <div className="mt-4">
              <label htmlFor="warranty-select" className={labelClass}>
                Product *
              </label>
              <select
                id="warranty-select"
                value={warrantyNumber}
                onChange={(e) => setWarrantyNumber(e.target.value)}
                className={inputClass}
              >
                {myWarranties.map((w) => (
                  <option key={w.warrantyNumber} value={w.warrantyNumber} disabled={!w.active}>
                    {w.productName} · S/N {w.serialNumber} · {w.warrantyNumber}
                    {w.active ? "" : " (warranty ended)"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setUseOther(true);
                  setWarrantyNumber("");
                }}
                className="mt-2 text-xs font-bold text-[#0fa8bf]"
              >
                Product not in this list (e.g. a gift)? Use a bill or warranty number →
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label htmlFor="owner-mobile" className={labelClass}>
                Registered Mobile Number *
              </label>
              <div className="flex">
                <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">
                  +91
                </span>
                <input
                  id="owner-mobile"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={lookupMobile}
                  onChange={(e) => {
                    setLookupMobile(e.target.value.replace(/\D/g, ""));
                    setItems(null);
                    setWarrantyNumber("");
                  }}
                  className={phoneInputClass}
                  placeholder="10-digit mobile number"
                />
              </div>
              <label htmlFor="reference" className={labelClass}>
                Bill / Warranty Number *
              </label>
              <div className="flex gap-2">
                <input
                  id="reference"
                  type="text"
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setItems(null);
                    setWarrantyNumber("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void lookup();
                    }
                  }}
                  className={inputClass}
                  placeholder="e.g. VDK26-SI1-8504"
                />
                <button
                  type="button"
                  onClick={lookup}
                  disabled={lookupBusy}
                  className="shrink-0 rounded-2xl bg-[#161616] px-5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {lookupBusy ? "…" : "Find"}
                </button>
              </div>
              <p className="text-xs text-black/50">
                Enter the mobile number registered with your warranty.
              </p>
              <ErrorBox message={lookupError} />
              {items && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">{items.length > 1 ? "Which product needs service?" : "Product"}</p>
                  {items.map((i) => (
                    <label
                      key={i.warrantyNumber}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition ${
                        !i.active
                          ? "cursor-not-allowed border-black/5 opacity-50"
                          : warrantyNumber === i.warrantyNumber
                            ? "border-[#ff5e79] bg-[#ff5e79]/5"
                            : "border-black/10 hover:border-black/25"
                      }`}
                    >
                      <input
                        type="radio"
                        name="product"
                        disabled={!i.active}
                        checked={warrantyNumber === i.warrantyNumber}
                        onChange={() => setWarrantyNumber(i.warrantyNumber)}
                        className="mt-1 accent-[#ff5e79]"
                      />
                      <span>
                        <span className="font-bold">{i.productName}</span>
                        <span className="block text-xs text-black/55">
                          Model {i.model}{i.serialEnd ? ` · Serial …${i.serialEnd}` : ""}
                          {i.store ? ` · ${i.store}` : ""} ·{" "}
                          {i.active ? (i.underWarranty ? "Under warranty" : "Warranty ended (chargeable)") : "Not active"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {loggedIn && myWarranties.length > 0 && (
                <button type="button" onClick={() => setUseOther(false)} className="text-xs font-bold text-[#0fa8bf]">
                  ← Choose from my products
                </button>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">2. Who should we contact?</h2>
          <p className="mt-1 text-sm text-black/55">The person using the product — we&apos;ll call and send updates to this number.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-name" className={labelClass}>
                Name *
              </label>
              <input
                id="contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={inputClass}
                autoComplete="name"
                placeholder="Full name"
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
            <div>
              <label htmlFor="alt-name" className={labelClass}>
                Alternate contact name <span className="font-normal text-black/40">(optional)</span>
              </label>
              <input
                id="alt-name"
                value={altName}
                onChange={(e) => setAltName(e.target.value)}
                className={inputClass}
                placeholder="e.g. spouse / family member"
              />
            </div>
            <div>
              <label htmlFor="alt-mobile" className={labelClass}>
                Alternate mobile <span className="font-normal text-black/40">(optional)</span>
              </label>
              <div className="flex">
                <div className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">
                  +91
                </div>
                <input
                  id="alt-mobile"
                  type="tel"
                  inputMode="numeric"
                  value={altMobile}
                  onChange={(e) => setAltMobile(e.target.value)}
                  maxLength={10}
                  className={phoneInputClass}
                  placeholder="Another number to reach you"
                />
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2 className="text-lg font-bold">3. The Problem</h2>
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

            {photosAllowed && <PhotoPicker photos={photos} onChange={setPhotos} required={photosRequired} />}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold">4. How Should We Help?</h2>
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
          <h2 className="text-lg font-bold">5. Your Location (optional)</h2>
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
