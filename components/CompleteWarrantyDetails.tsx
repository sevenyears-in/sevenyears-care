"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, labelClass } from "@/components/SiteChrome";

/** Shown on warranties imported from Zoho until the serial number / address are filled in. */
export function CompleteWarrantyDetails({
  id,
  model,
  needsSerial,
  needsAddress,
}: {
  id: string;
  model: string;
  needsSerial: boolean;
  needsAddress: boolean;
}) {
  const router = useRouter();
  const [modelNumber, setModelNumber] = useState(model);
  const [serialNumber, setSerialNumber] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/staff/warranties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelNumber, serialNumber, customerAddress: address }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(data.error ?? "Unable to save.");
  };

  return (
    <div className="rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200 md:col-span-2">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Imported from Zoho — details to complete</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {needsSerial && (
          <>
            <label>
              <span className={labelClass}>Model number</span>
              <input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Serial number</span>
              <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className={inputClass} />
            </label>
          </>
        )}
        {needsAddress && (
          <label className="sm:col-span-2">
            <span className={labelClass}>Customer address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </label>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-[#d43852]">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="mt-3 rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save details"}
      </button>
    </div>
  );
}
