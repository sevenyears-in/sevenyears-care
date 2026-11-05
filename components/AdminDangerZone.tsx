"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/SiteChrome";

type Props =
  | { kind: "service" | "complaint"; id: string; number: string }
  | { kind: "warranty"; id: string; number: string; voided: boolean; voidReason?: string | null };

const LIST = { service: "/staff/service", complaint: "/staff/complaints", warranty: "/staff/warranties" };
const NAME = { service: "service request", complaint: "complaint", warranty: "warranty" };

/** Super Admin only: void / un-void a warranty, or delete a request, complaint or warranty for good. */
export function AdminDangerZone(props: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "void" | "delete">("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const call = async (url: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) {
      setError(data.error ?? "Unable to save.");
      return false;
    }
    return true;
  };

  const doDelete = async () => {
    const url = props.kind === "warranty" ? `/api/staff/warranties/${props.id}` : `/api/staff/tickets/${props.kind}/${props.id}`;
    if (await call(url, { method: "DELETE" })) {
      router.push(LIST[props.kind]);
      router.refresh();
    }
  };

  const doVoid = async (action: "void" | "unvoid") => {
    if (await call(`/api/staff/warranties/${props.id}`, { method: "PATCH", body: JSON.stringify({ action, reason }) })) {
      setMode("");
      setReason("");
      router.refresh();
    }
  };

  const isWarranty = props.kind === "warranty";
  const voided = isWarranty && props.voided;

  return (
    <div className="rounded-3xl border border-red-200 bg-red-50/40 p-5 md:col-span-2">
      <p className="text-xs font-bold uppercase tracking-wider text-red-700">Super Admin</p>
      {voided && (
        <p className="mt-2 text-sm text-red-800">
          This warranty is <b>void</b>
          {props.kind === "warranty" && props.voidReason ? ` — ${props.voidReason}` : ""}.
        </p>
      )}

      {!mode && (
        <div className="mt-3 flex flex-wrap gap-2">
          {isWarranty &&
            (voided ? (
              <button type="button" disabled={busy} onClick={() => doVoid("unvoid")} className="rounded-xl bg-white px-4 py-2 text-sm font-bold ring-1 ring-black/10">
                Make active again
              </button>
            ) : (
              <button type="button" onClick={() => setMode("void")} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-red-700 ring-1 ring-red-200">
                Void warranty
              </button>
            ))}
          <button type="button" onClick={() => setMode("delete")} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white">
            Delete {NAME[props.kind]}
          </button>
        </div>
      )}

      {mode === "void" && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-black/70">The warranty stays in the records but is no longer valid. The customer can&apos;t request service on it.</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for voiding" className={inputClass} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => doVoid("void")} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              {busy ? "Saving…" : "Void warranty"}
            </button>
            <button type="button" onClick={() => setMode("")} className="px-3 py-2 text-sm text-black/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "delete" && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-black/70">
            This permanently deletes the {NAME[props.kind]} and its history{props.kind === "service" ? ", photos" : ""} and feedback. It can&apos;t be
            undone. Type <b className="font-mono">{props.number}</b> to confirm.
          </p>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={props.number} className={inputClass} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || confirmText.trim().toUpperCase() !== props.number.toUpperCase()}
              onClick={doDelete}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button type="button" onClick={() => setMode("")} className="px-3 py-2 text-sm text-black/50">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
