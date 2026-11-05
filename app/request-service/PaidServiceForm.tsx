"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { cardClass, ErrorBox, inputClass, labelClass, phoneInputClass, primaryButtonClass } from "@/components/SiteChrome";
import { todayISO } from "@/lib/helpers";
import {
  PAID_HOME_VISIT_NOTE,
  PAID_PRODUCT_TYPES,
  PAID_SERVICE_NOTE,
  PHOTO_OPTIONAL_ISSUES,
  PHOTO_REQUIRED_ISSUES,
  SERVICE_ISSUE_TYPES,
  SERVICE_MODES,
} from "@/lib/site-config";
import { PhotoPicker, uploadPhotos, type PickedPhoto } from "@/components/PhotoPicker";

/** Chargeable service for products bought elsewhere or without a Seven Years warranty. */
export default function PaidServiceForm({ stores }: { stores: string[] }) {
  const [contactName, setContactName] = useState("");
  const [mobile, setMobile] = useState("");
  const [altName, setAltName] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [productType, setProductType] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [purchasedFrom, setPurchasedFrom] = useState("");
  const [issueType, setIssueType] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [storeName, setStoreName] = useState(stores.length === 1 ? stores[0] : "");
  const [serviceMode, setServiceMode] = useState("store_visit");
  const [preferredDate, setPreferredDate] = useState("");
  const [address, setAddress] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ request_number: string } | null>(null);

  const photosRequired = PHOTO_REQUIRED_ISSUES.includes(issueType);
  const photosAllowed = photosRequired || PHOTO_OPTIONAL_ISSUES.includes(issueType);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const m = mobile.replace(/\D/g, "");
    if (!contactName.trim()) return setError("Enter your name.");
    if (!/^[6-9]\d{9}$/.test(m)) return setError("Enter a valid 10-digit mobile number.");
    if (altMobile && !/^[6-9]\d{9}$/.test(altMobile.replace(/\D/g, ""))) return setError("The alternate mobile number is not valid.");
    if (!productType) return setError("Choose the type of product.");
    if (!brand.trim()) return setError("Enter the brand of the product.");
    if (!issueType) return setError("Choose the type of problem.");
    if (description.trim().length < 10) return setError("Please describe the problem in a little more detail.");
    if (photosRequired && photos.length < 3) return setError("Please add 3 photos of the product from different angles.");
    if (!storeName) return setError("Choose the store.");
    if (serviceMode === "home_visit" && address.trim().length < 10) return setError("Enter the address for the home visit / pickup.");
    if (!agreed) return setError("Please confirm that you understand the service is chargeable.");

    setSubmitting(true);
    try {
      let photoPaths: string[] = [];
      if (photosAllowed && photos.length) {
        try {
          photoPaths = await uploadPhotos(photos);
        } catch (err) {
          setError(err instanceof Error ? err.message : "A photo could not be uploaded. Please try again.");
          return;
        }
      }
      const res = await fetch("/api/service-requests/paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName,
          contactMobile: m,
          altName,
          altMobile: altMobile.replace(/\D/g, ""),
          productType,
          brand,
          model,
          purchasedFrom,
          issueType,
          description,
          photos: photoPaths,
          storeName,
          serviceMode,
          preferredDate: preferredDate || null,
          address,
          agreed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "Unable to create the service request.");
      setCreated(data.request);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className={cardClass}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">✓</div>
        <h2 className="mt-6 text-2xl font-bold">Service request received</h2>
        <p className="mt-2 text-black/60">
          Our service team will contact you on +91 {mobile.replace(/\D/g, "")} to arrange the inspection.
        </p>
        <div className="mt-6 rounded-3xl bg-[#161616] p-6 text-white">
          <p className="text-xs uppercase tracking-wider text-white/50">Request Number</p>
          <p className="mt-2 text-2xl font-bold">{created.request_number}</p>
          <p className="mt-3 text-sm text-white/70">{PAID_SERVICE_NOTE}</p>
        </div>
        <Link href={`/track-request?ticket=${encodeURIComponent(created.request_number)}`} className={`${primaryButtonClass} mt-6 inline-block`}>
          Track this request
        </Link>
      </div>
    );
  }

  const section = "text-lg font-bold";
  return (
    <form onSubmit={submit} className={`${cardClass} space-y-8`}>
      <div className="rounded-2xl border border-[#f39237]/30 bg-[#f39237]/10 p-4 text-sm text-[#7a3f06]">
        <p className="font-bold">Paid service</p>
        <p className="mt-1">{PAID_SERVICE_NOTE}</p>
      </div>

      <section>
        <h2 className={section}>1. Your Details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Name *</span>
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClass} placeholder="Full name" />
          </label>
          <label className="block">
            <span className={labelClass}>Mobile Number *</span>
            <div className="flex">
              <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">+91</span>
              <input type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} className={phoneInputClass} placeholder="10-digit mobile number" />
            </div>
          </label>
          <label className="block">
            <span className={labelClass}>Alternate Contact Name</span>
            <input value={altName} onChange={(e) => setAltName(e.target.value)} className={inputClass} placeholder="Optional" />
          </label>
          <label className="block">
            <span className={labelClass}>Alternate Mobile Number</span>
            <div className="flex">
              <span className="flex items-center rounded-l-2xl border border-r-0 border-black/10 bg-[#f7f9fb] px-4 text-sm font-semibold">+91</span>
              <input type="tel" inputMode="numeric" maxLength={10} value={altMobile} onChange={(e) => setAltMobile(e.target.value.replace(/\D/g, ""))} className={phoneInputClass} placeholder="Optional" />
            </div>
          </label>
        </div>
      </section>

      <section>
        <h2 className={section}>2. The Product</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Product Type *</span>
            <select value={productType} onChange={(e) => setProductType(e.target.value)} className={inputClass}>
              <option value="">Select</option>
              {PAID_PRODUCT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Brand *</span>
            <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputClass} placeholder="e.g. Totsy, R for Rabbit" />
          </label>
          <label className="block">
            <span className={labelClass}>Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} placeholder="If known" />
          </label>
          <label className="block">
            <span className={labelClass}>Purchased From</span>
            <input value={purchasedFrom} onChange={(e) => setPurchasedFrom(e.target.value)} className={inputClass} placeholder="Shop / website name" />
          </label>
        </div>
      </section>

      <section>
        <h2 className={section}>3. The Problem</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className={labelClass}>Type of Problem *</span>
            <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className={inputClass}>
              <option value="">Select the problem</option>
              {SERVICE_ISSUE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Describe the Problem *</span>
            <textarea rows={4} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} placeholder="What happened, when did it start, and anything you've already tried." />
          </label>
          {photosAllowed && <PhotoPicker photos={photos} onChange={setPhotos} required={photosRequired} />}
        </div>
      </section>

      <section>
        <h2 className={section}>4. How Should We Help?</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className={labelClass}>Store *</span>
            <select value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputClass}>
              <option value="">Select your nearest store</option>
              {stores.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {SERVICE_MODES.map((m) => (
              <label
                key={m.value}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 text-sm font-semibold ${
                  serviceMode === m.value ? "border-[#11b8d0] bg-[#11b8d0]/5" : "border-black/10"
                }`}
              >
                <input type="radio" name="mode" checked={serviceMode === m.value} onChange={() => setServiceMode(m.value)} className="accent-[#11b8d0]" />
                <span>
                  {m.label}
                  {m.value === "home_visit" && <span className="block text-xs font-normal text-[#b45f0e]">{PAID_HOME_VISIT_NOTE}</span>}
                </span>
              </label>
            ))}
          </div>
          {serviceMode === "home_visit" && (
            <label className="block">
              <span className={labelClass}>Address *</span>
              <textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} placeholder="House name, street, area, landmark, PIN code" />
            </label>
          )}
          <label className="block sm:max-w-xs">
            <span className={labelClass}>Preferred Date</span>
            <input type="date" min={todayISO()} value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} className={inputClass} />
          </label>
        </div>
      </section>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#f7f9fb] p-4 text-sm">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#f39237]" />
        <span>
          I understand this is a paid service. {PAID_SERVICE_NOTE}
          {serviceMode === "home_visit" ? ` ${PAID_HOME_VISIT_NOTE}` : ""}
        </span>
      </label>

      <ErrorBox message={error} />
      <button type="submit" disabled={submitting} className={`${primaryButtonClass} w-full disabled:opacity-50`}>
        {submitting ? "Sending…" : "Submit Paid Service Request"}
      </button>
    </form>
  );
}
