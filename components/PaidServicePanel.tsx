"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass, labelClass } from "@/components/SiteChrome";

type Props = {
  id: string;
  canQuote: boolean;
  brand: string | null;
  model: string | null;
  purchasedFrom: string | null;
  homeVisit: boolean;
  quoteAmount: number | null;
  quoteNote: string | null;
  quoteStatus: "pending" | "approved" | "declined" | null;
  quoteSentAt: string | null;
  quoteDecidedAt: string | null;
};

const STATUS = {
  pending: { label: "Waiting for customer approval", cls: "bg-amber-100 text-amber-900" },
  approved: { label: "Approved by customer — start the repair", cls: "bg-green-100 text-green-800" },
  declined: { label: "Declined by customer", cls: "bg-red-100 text-red-700" },
};

/** Paid service: product details + the repair quote the customer approves online. */
export function PaidServicePanel(p: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(p.quoteAmount ? String(p.quoteAmount) : "");
  const [note, setNote] = useState(p.quoteNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/staff/service-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, amount: Number(amount), note }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "Unable to send the quote.");
    setOpen(false);
    router.refresh();
  };

  const s = p.quoteStatus ? STATUS[p.quoteStatus] : null;

  return (
    <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
      <div className="h-1.5 bg-[#f39237]" aria-hidden />
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#f39237] px-3 py-1 text-xs font-bold text-white">PAID SERVICE</span>
          {p.homeVisit && <span className="rounded-full bg-[#f39237]/15 px-3 py-1 text-xs font-bold text-[#b45f0e]">Home visit — chargeable</span>}
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-black/45">Brand</dt>
            <dd className="font-semibold">{p.brand || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-black/45">Model</dt>
            <dd className="font-semibold">{p.model || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-black/45">Bought from</dt>
            <dd className="font-semibold">{p.purchasedFrom || "—"}</dd>
          </div>
        </dl>

        <div className="rounded-2xl bg-[#f7f9fb] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-black/45">Repair quote</p>
          {p.quoteStatus ? (
            <>
              <p className="mt-1 text-2xl font-bold">₹{Number(p.quoteAmount ?? 0).toLocaleString("en-IN")}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-black/70">{p.quoteNote}</p>
              {s && <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${s.cls}`}>{s.label}</p>}
            </>
          ) : (
            <p className="mt-1 text-sm text-black/60">
              Inspect the product, then send the repair quote. Repair work can start only after the customer approves it.
            </p>
          )}
        </div>

        {p.canQuote && p.quoteStatus !== "approved" && !open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white">
            {p.quoteStatus ? "Send a revised quote" : "Send repair quote"}
          </button>
        )}
        {open && (
          <div className="space-y-3">
            <label className="block">
              <span className={labelClass}>Repair cost (₹)</span>
              <input type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>What will be repaired / replaced</span>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </label>
            {error && <p className="text-sm text-[#d43852]">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={send} disabled={busy} className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">
                {busy ? "Sending…" : "Send to customer"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-2.5 text-sm text-black/50">
                Cancel
              </button>
            </div>
            <p className="text-xs text-black/45">The customer gets a WhatsApp / SMS link to approve or decline.</p>
          </div>
        )}
      </div>
    </div>
  );
}
