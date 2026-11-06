// Extended warranty requests (shown on the main Dashboard and on its own page).

import Link from "next/link";
import type { StaffUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/helpers";
import { extendedSettings, rupees, type ExtensionRequest } from "@/lib/extended-warranty";
import { canHandleExtensions, sameStoreOrCorporate } from "@/lib/extended-access";
import { ExtensionActions } from "@/components/ExtensionActions";
import { hasSection } from "@/lib/access";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_inspection: { label: "Inspection needed", cls: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  awaiting_payment: { label: "Waiting for payment", cls: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  paid: { label: "Paid · active", cls: "bg-green-50 text-green-700 ring-green-600/20" },
  inspection_failed: { label: "Not covered", cls: "bg-red-50 text-red-700 ring-red-600/20" },
};

export async function ExtendedWarrantySection({ staff, full = false }: { staff: StaffUser; full?: boolean }) {
  const s = await extendedSettings();
  const { data, error } = await supabaseAdmin
    .from("warranty_extensions")
    .select("*")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(300);
  const all = ((data ?? []) as ExtensionRequest[]).filter(
    // Unpaid "direct" checkouts that were abandoned are not shown.
    (r) => sameStoreOrCorporate(staff, r.store_name) && !(r.kind === "direct" && r.status !== "paid")
  );
  const open = all.filter((r) => r.status === "pending_inspection" || r.status === "awaiting_payment");
  const done = all.filter((r) => r.status === "paid" || r.status === "inspection_failed").slice(0, 50);
  const canAct = hasSection(staff, "extended") && staff.role !== "director";
  const month = new Date().toISOString().slice(0, 7);
  const paidThisMonth = all.filter((r) => r.status === "paid" && r.paid_at && r.paid_at.slice(0, 7) === month);

  const card = "soft-card rounded-3xl bg-white ring-1 ring-black/5";
  const row = (r: ExtensionRequest) => (
    <li key={r.id} className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-black/50">{r.warranty_number}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS[r.status]?.cls ?? ""}`}>
          {STATUS[r.status]?.label ?? r.status}
        </span>
        <span className="text-xs text-black/40">
          {r.kind === "direct" ? "Bought within 10 days" : "After inspection"} · {rupees(Number(r.price))}
        </span>
      </div>
      <p className="mt-1.5 font-semibold">{r.product_name}</p>
      <p className="text-sm text-black/55">
        {[r.customer_name, r.customer_mobile, r.store_name].filter(Boolean).join(" · ")} · Requested {formatDateTime(r.created_at)}
      </p>
      {(r as { customer_note?: string | null }).customer_note && (
        <p className="mt-1 text-sm text-black/65">Customer: “{(r as { customer_note?: string | null }).customer_note}”</p>
      )}
      {r.inspected_by_name && (
        <p className="mt-1 text-xs text-black/50">
          Inspected by {r.inspected_by_name} · {formatDateTime(r.inspected_at)}
          {r.inspection_note ? ` — ${r.inspection_note}` : ""}
        </p>
      )}
      {r.status === "paid" && (
        <p className="mt-1 text-xs font-semibold text-green-700">
          Paid {r.payment_mode === "store" ? "at the store" : "online"} · {formatDate(r.paid_at)}
        </p>
      )}
      {canAct && (r.status === "pending_inspection" || r.status === "awaiting_payment") && (
        <ExtensionActions id={r.id} status={r.status} priceLabel={rupees(Number(r.price))} />
      )}
    </li>
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className={full ? "text-3xl font-bold" : "text-xl font-bold"}>Extended Warranty</h2>
          <p className="mt-1 text-sm text-black/55">
            {rupees(s.price)} for +{s.months} months · within {s.windowDays} days of purchase customers buy it straight away;
            after that a technician inspects the product first.
          </p>
        </div>
        {!full && (
          <Link href="/staff/extended-warranty" className="text-sm font-bold text-[#ff5e79]">
            All requests →
          </Link>
        )}
      </div>

      {error && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          Extended warranty is not set up in the database yet. Ask the Super Admin to run the latest database update.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Inspections waiting", value: open.filter((r) => r.status === "pending_inspection").length, tone: "text-amber-700" },
          { label: "Approved, not paid", value: open.filter((r) => r.status === "awaiting_payment").length, tone: "text-sky-700" },
          { label: "Sold this month", value: paidThisMonth.length, tone: "text-green-700" },
        ].map((x) => (
          <div key={x.label} className={`${card} p-5`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-black/45">{x.label}</p>
            <p className={`mt-2 text-3xl font-bold tracking-tight ${x.tone}`}>{x.value}</p>
          </div>
        ))}
      </div>

      {open.length > 0 ? (
        <ul className={`${card} divide-y divide-black/5 overflow-hidden`}>{(full ? open : open.slice(0, 5)).map(row)}</ul>
      ) : (
        full && <p className={`${card} p-6 text-center text-sm text-black/55`}>Nothing waiting. 🎉</p>
      )}

      {full && (
        <div className="space-y-3 pt-2">
          <h3 className="text-xl font-bold">Recent</h3>
          {done.length === 0 ? (
            <p className={`${card} p-6 text-center text-sm text-black/55`}>No extended warranties sold yet.</p>
          ) : (
            <ul className={`${card} divide-y divide-black/5 overflow-hidden`}>{done.map(row)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
