import { notFound } from "next/navigation";
import { PageShell } from "@/components/SiteChrome";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readQuoteToken } from "@/lib/quote-token";
import { formatDateTime } from "@/lib/helpers";
import { QuoteDecision } from "@/components/QuoteDecision";

export const dynamic = "force-dynamic";

export default async function ServiceQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = readQuoteToken(token);
  if (!id) notFound();
  const { data: r } = await supabaseAdmin
    .from("service_requests")
    .select("request_number, product_name, store_name, issue_type, quote_amount, quote_note, quote_status, quote_sent_at, quote_decided_at, status")
    .eq("id", id)
    .maybeSingle();
  if (!r || !r.quote_status) notFound();

  const amount = `₹${Number(r.quote_amount ?? 0).toLocaleString("en-IN")}`;
  return (
    <PageShell title="Repair Quote" intro="Please review the repair quote for your product.">
      <div className="mx-auto max-w-xl overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
        <div className="h-1.5 bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sm font-bold text-black/50">{r.request_number}</span>
            {r.store_name && <span className="rounded-full bg-[#11b8d0]/10 px-3 py-1 text-xs font-bold text-[#0b7f90]">{r.store_name}</span>}
          </div>
          <div>
            <p className="text-lg font-bold">{r.product_name}</p>
            <p className="text-sm text-black/55">{r.issue_type}</p>
          </div>
          <div className="rounded-2xl bg-[#f7f9fb] p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-black/45">Repair cost</p>
            <p className="mt-1 text-3xl font-bold">{amount}</p>
            <p className="mt-2 whitespace-pre-line text-sm text-black/70">{r.quote_note}</p>
            {r.quote_sent_at && <p className="mt-2 text-xs text-black/40">Sent {formatDateTime(r.quote_sent_at)}</p>}
          </div>
          {r.quote_status === "pending" && !["closed", "cancelled"].includes(String(r.status)) ? (
            <QuoteDecision token={token} />
          ) : (
            <p
              className={`rounded-2xl p-4 text-sm font-semibold ${
                r.quote_status === "approved" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"
              }`}
            >
              {r.quote_status === "approved"
                ? "You approved this quote. Our technician will go ahead with the repair."
                : r.quote_status === "declined"
                  ? "You declined this quote. Our team will contact you about collecting your product."
                  : "This request is closed."}
              {r.quote_decided_at ? ` (${formatDateTime(r.quote_decided_at)})` : ""}
            </p>
          )}
          <p className="text-xs text-black/45">The inspection charge applies whether or not the repair is approved.</p>
        </div>
      </div>
    </PageShell>
  );
}
