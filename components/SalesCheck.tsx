"use client";

// Settings → Sales check: compare a day with Zoho POS, or copy it again.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DayCheck } from "@/lib/reconcile";

const rs = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function post(body: unknown) {
  const res = await fetch("/api/staff/admin/performance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed.");
  return data;
}

export function DayActions({ date }: { date: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "check" | "copy">("");
  const [check, setCheck] = useState<DayCheck | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function run(kind: "check" | "copy") {
    setBusy(kind);
    setError("");
    setMsg("");
    try {
      if (kind === "check") setCheck(await post({ action: "reconcile_day", date }));
      else {
        // Copy again until nothing is pending (30 bills a round).
        let rounds = 0;
        let r: { bills: number; billsSaved: number; returnsSaved: number; pending: number };
        do {
          r = await post({ action: "sync", date });
          rounds++;
        } while (r.pending > 0 && rounds < 20);
        setMsg(`Copied: ${r.bills} bill(s) in Zoho${r.pending ? `, ${r.pending} still pending` : ", all up to date"}.`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button className="rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-black/10 hover:bg-black/5 disabled:opacity-50" disabled={!!busy} onClick={() => run("check")}>
          {busy === "check" ? "Checking…" : "Check with Zoho"}
        </button>
        <button className="rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-black/10 hover:bg-black/5 disabled:opacity-50" disabled={!!busy} onClick={() => run("copy")}>
          {busy === "copy" ? "Copying…" : "Copy again"}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {msg && <p className="text-xs text-green-700">{msg}</p>}
      {check && (
        <div className="rounded-xl bg-black/[0.02] p-3 text-xs ring-1 ring-black/5">
          <p className={`font-bold ${check.ok ? "text-green-700" : "text-[#d6224a]"}`}>{check.ok ? "✓ Matches Zoho POS" : "Differences found"} ({check.reads} Zoho request(s))</p>
          {check.note && <p className="text-amber-800">{check.note}</p>}
          {check.stores.map((s) => (
            <div key={s.store} className="mt-2">
              <p className="font-semibold">
                {s.store}: Zoho {s.zoho.bills} bills {rs(s.zoho.billed)} − {s.zoho.returns} returns {rs(s.zoho.returned)} = {rs(s.net.zoho)} · Here {s.here.bills} bills {rs(s.here.billed)} − {s.here.returns} returns{" "}
                {rs(s.here.returned)} = {rs(s.net.here)} {s.ok ? "✓" : "✗"}
              </p>
              {s.missingHere.length > 0 && <p>Missing here: {s.missingHere.map((b) => `${b.number} (${rs(b.amount)})`).join(", ")}</p>}
              {s.notInZoho.length > 0 && <p>Not in Zoho any more (void/deleted): {s.notInZoho.map((b) => `${b.number} (${rs(b.amount)})`).join(", ")}</p>}
              {s.amountChanged.length > 0 && <p>Amount changed in Zoho: {s.amountChanged.map((b) => `${b.number} (Zoho ${rs(b.zoho)}, here ${rs(b.here)})`).join(", ")}</p>}
              {!s.ok && <p className="text-black/55">Press “Copy again” to bring this day up to date.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
