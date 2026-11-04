"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, labelClass } from "@/components/SiteChrome";

/** Staff / CRE: record who uses the product when it was a gift (also for old warranties). */
export function ProductUserEditor({
  id,
  name,
  mobile,
}: {
  id: string;
  name: string | null;
  mobile: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [userName, setUserName] = useState(name ?? "");
  const [userMobile, setUserMobile] = useState(mobile ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const save = async (clear = false) => {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/staff/warranties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "user", userName: clear ? "" : userName, userMobile: clear ? "" : userMobile }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Unable to save.");
    setOpen(false);
    setDone(
      clear
        ? "Saved — the buyer is the product user."
        : data.login?.created
          ? `Saved. Login created — User ID ${userMobile}, password ${data.login.password}. The user has been sent their certificate link.`
          : "Saved. The user has been sent their certificate link."
    );
    router.refresh();
  };

  return (
    <div className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
      <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Product user (gift)</p>
      {!open ? (
        <>
          <p className="mt-3 text-sm">
            {mobile ? (
              <>
                <b>{name}</b> · +91 {mobile}
                <span className="block text-xs text-black/50">Messages, service updates and login go to this number.</span>
              </>
            ) : (
              <span className="text-black/55">Same as the buyer.</span>
            )}
          </p>
          {done && <p className="mt-2 text-xs text-green-700">{done}</p>}
          <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-bold text-[#0b7f90] hover:underline">
            {mobile ? "Change product user" : "Add product user"}
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className={labelClass}>User&apos;s name</span>
            <input value={userName} onChange={(e) => setUserName(e.target.value)} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>User&apos;s mobile</span>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={userMobile}
              onChange={(e) => setUserMobile(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
            />
          </label>
          {error && <p className="text-sm text-[#d43852]">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => save()}
              disabled={busy}
              className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {mobile && (
              <button type="button" onClick={() => save(true)} disabled={busy} className="rounded-2xl px-4 py-2.5 text-sm font-bold ring-1 ring-black/10">
                User is the buyer
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2.5 text-sm text-black/50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
