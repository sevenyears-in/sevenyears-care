import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PageShell, StatusBadge } from "@/components/SiteChrome";
import { CustomerLogoutButton } from "@/components/CustomerLogoutButton";
import { InstallAppCard } from "@/components/InstallApp";
import { formatDate, formatDateTime, statusLabel, todayISO } from "@/lib/helpers";
import { feedbackLink } from "@/lib/feedback-token";
import { complaintKind, customerComplaintStatus } from "@/lib/sla";
import { loadFamily } from "@/lib/family";
import { FamilyDatesEditor } from "@/components/FamilyDatesEditor";
import { FeedbackPrompt, type PendingFeedback } from "@/components/FeedbackPrompt";
import { WebPushButton } from "@/components/WebPushButton";
import { OffersBanner } from "@/components/OffersBanner";
import { zohoBillFeedbackId } from "@/lib/feedback";
import { fetchInvoicesForMobile } from "@/lib/zoho";
import { ServiceCoverageBlock } from "@/components/ServiceCoverageBlock";

// Zoho bills for customers with no registered warranty (cached so the page stays quick).
const billCache = new Map<string, { at: number; bills: { billNumber: string; billDate: string }[] }>();
async function zohoBills(mobile: string) {
  const hit = billCache.get(mobile);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.bills;
  const bills = await fetchInvoicesForMobile(mobile).catch(() => []);
  billCache.set(mobile, { at: Date.now(), bills });
  return bills;
}

export const metadata = { title: "My Account" };
export const dynamic = "force-dynamic";

// Customer portal: warranties, service requests and complaints for the logged-in mobile number.
export default async function AccountPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/account/login");

  const [warranties, services, complaints, feedback, family] = await Promise.all([
    supabaseAdmin
      .from("warranties")
      .select(
        "id, warranty_number, verification_token, product_name, model_number, serial_number, bill_number, bill_date, store_name, warranty_expiry_date, extended_warranty_purchased, status, service_coverage"
      )
      .or(`customer_mobile.eq.${customer.mobile},alternate_mobile.eq.${customer.mobile}`)
      .order("bill_date", { ascending: false }),
    // Requests they raised or are the alternate contact for.
    supabaseAdmin
      .from("service_requests")
      .select("id, request_number, product_name, issue_type, status, resolution_notes, created_at, updated_at")
      .or(`contact_mobile.eq.${customer.mobile},alternate_mobile.eq.${customer.mobile}`)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("complaints")
      .select("id, complaint_number, category, status, resolution_notes, created_at, updated_at, reference_number, store_name, involved_staff_name")
      .eq("contact_mobile", customer.mobile)
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("customer_feedback").select("kind, ref_id, ref_number, resolved, answers").eq("mobile", customer.mobile),
    loadFamily(customer.mobile),
  ]);

  // Plus requests on products they bought (e.g. raised by the person they gifted it to).
  const myWarrantyIds = (warranties.data ?? []).map((w) => w.id);
  const { data: onMyProducts } = myWarrantyIds.length
    ? await supabaseAdmin
        .from("service_requests")
        .select("id, request_number, product_name, issue_type, status, resolution_notes, created_at, updated_at")
        .in("warranty_id", myWarrantyIds)
    : { data: [] };
  const serviceList = [...(services.data ?? []), ...(onMyProducts ?? [])]
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // Feedback already given (the table may not exist yet — then everything is "not rated").
  const given = feedback.data ?? [];
  const rated = (kind: string, id: string, number?: string) =>
    given.some(
      (f) =>
        f.kind === kind &&
        (kind === "sales" ? f.ref_number === number : f.ref_id === id) &&
        Object.keys((f.answers ?? {}) as object).length > 0
    );
  const confirmedComplaint = (id: string) => given.some((f) => f.kind === "complaint" && f.ref_id === id && f.resolved);
  const bills = new Set<string>();
  const salesLink = (w: { id: string; bill_number: string }) => {
    if (bills.has(w.bill_number)) return null; // one sales feedback per bill
    bills.add(w.bill_number);
    return rated("sales", w.id, w.bill_number) ? null : feedbackLink("sales", w.id);
  };
  const rateButton = "rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-[#161616]";

  // Ask for feedback right after login: purchases, finished services and closed complaints not rated yet.
  const pending: PendingFeedback[] = [];
  const promptBills = new Set<string>();
  for (const w of warranties.data ?? []) {
    if (promptBills.has(w.bill_number)) continue;
    promptBills.add(w.bill_number);
    if (!rated("sales", w.id, w.bill_number))
      pending.push({ label: "Your purchase", detail: `Bill ${w.bill_number} · ${w.store_name ?? "Seven Years"}`, href: feedbackLink("sales", w.id) });
  }
  if ((warranties.data ?? []).length === 0) {
    const recent = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
    for (const b of (await zohoBills(customer.mobile)).filter((b) => b.billDate >= recent).slice(0, 3)) {
      if (given.some((f) => f.kind === "sales" && String(f.ref_number).toUpperCase() === b.billNumber.toUpperCase())) continue;
      pending.push({
        label: "Your purchase",
        detail: `Bill ${b.billNumber} · ${formatDate(b.billDate)}`,
        href: feedbackLink("sales", zohoBillFeedbackId(b.billNumber, customer.mobile)),
      });
    }
  }
  for (const r of serviceList)
    if (["resolved", "closed"].includes(r.status) && !rated("service", r.id))
      pending.push({ label: "Service", detail: `${r.request_number} · ${r.product_name ?? ""}`, href: feedbackLink("service", r.id) });
  for (const c of complaints.data ?? [])
    if (["resolved", "closed"].includes(c.status) && !rated("complaint", c.id))
      pending.push({ label: "Complaint handling", detail: c.complaint_number, href: feedbackLink("complaint", c.id) });

  const today = todayISO();
  const card = "rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6";

  return (
    <PageShell
      eyebrow="My Account"
      title={`Hello${customer.name ? `, ${customer.name}` : ""}`}
      intro={`Logged in with +91 ${customer.mobile}.`}
    >
      <FeedbackPrompt items={pending} sessionKey={`sy-feedback-ask-${customer.mobile}`} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/request-service" className="rounded-2xl bg-[#ff5e79] px-4 py-2.5 text-sm font-bold text-white">
          Request Service
        </Link>
        <Link href="/register-complaint" className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white">
          Register a Complaint
        </Link>
        <Link href="/offers" className="rounded-2xl bg-[#8883d7] px-4 py-2.5 text-sm font-bold text-white">
          🎁 Offers
        </Link>
        <Link href="/account/password" className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-bold">
          Change Password
        </Link>
        <CustomerLogoutButton />
      </div>

      <OffersBanner mobile={customer.mobile} className="mb-6" />

      <div className="mb-8 space-y-3">
        <WebPushButton />
        <InstallAppCard audience="customer" />
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">My Warranties</h2>
        {(warranties.data ?? []).length === 0 ? (
          <p className={`${card} text-sm text-black/55`}>No warranties found for this mobile number.</p>
        ) : (
          (warranties.data ?? []).map((w) => {
            const status = w.status !== "active" ? "void" : w.warranty_expiry_date < today ? "expired" : "active";
            const rateLink = salesLink(w);
            return (
              <div key={w.id} className={card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-bold text-black/50">{w.warranty_number}</p>
                    <p className="mt-1 text-lg font-bold">{w.product_name}</p>
                    <p className="text-sm text-black/55">
                      Model {w.model_number} · Serial {w.serial_number}
                    </p>
                    <p className="mt-1 text-sm text-black/55">
                      Bill {w.bill_number} · {formatDate(w.bill_date)}
                      {w.store_name ? ` · ${w.store_name}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={status} label={statusLabel(status)} />
                </div>
                <p className="mt-3 text-sm">
                  Covered until <span className="font-bold">{formatDate(w.warranty_expiry_date)}</span>
                  {w.extended_warranty_purchased ? " (extended)" : ""}
                </p>
                <ServiceCoverageBlock coverage={w.service_coverage} store={w.store_name} className="mt-3" />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/warranty/${w.verification_token}`}
                    className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold hover:bg-[#f7f9fb]"
                  >
                    View certificate
                  </Link>
                  <a
                    href={`/api/certificate/${w.verification_token}/pdf`}
                    className="rounded-xl bg-[#161616] px-3 py-2 text-xs font-bold text-white"
                  >
                    Download PDF
                  </a>
                  {status === "active" && (
                    <Link
                      href={`/request-service?warranty=${encodeURIComponent(w.warranty_number)}`}
                      className="rounded-xl bg-[#ff5e79] px-3 py-2 text-xs font-bold text-white"
                    >
                      Request service
                    </Link>
                  )}
                  <Link
                    href={`/register-complaint?ref=${encodeURIComponent(w.bill_number)}`}
                    className="rounded-xl border border-black/10 px-3 py-2 text-xs font-bold hover:bg-[#f7f9fb]"
                  >
                    Complaint about this purchase
                  </Link>
                  {status === "active" && !w.extended_warranty_purchased && (
                    <Link
                      href={`/extend/${w.verification_token}`}
                      className="rounded-xl bg-[#8883d7] px-3 py-2 text-xs font-bold text-white"
                    >
                      + Extended warranty
                    </Link>
                  )}
                  {rateLink && (
                    <a href={rateLink} className={rateButton}>
                      ★ Rate your purchase
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-bold">My Service Requests</h2>
        {serviceList.length === 0 ? (
          <p className={`${card} text-sm text-black/55`}>No service requests yet.</p>
        ) : (
          serviceList.map((r) => (
            <div key={r.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-bold text-black/50">{r.request_number}</p>
                  <p className="mt-1 font-bold">{r.product_name ?? "Product"}</p>
                  <p className="text-sm text-black/55">{r.issue_type}</p>
                </div>
                <StatusBadge status={r.status} label={statusLabel(r.status)} />
              </div>
              {r.resolution_notes && <p className="mt-3 rounded-2xl bg-[#f7f9fb] p-3 text-sm">{r.resolution_notes}</p>}
              {["resolved", "closed"].includes(r.status) && !rated("service", r.id) && (
                <a href={feedbackLink("service", r.id)} className={`mt-3 inline-block ${rateButton}`}>
                  ★ Rate service
                </a>
              )}
              <p className="mt-3 text-xs text-black/45">
                Raised {formatDateTime(r.created_at)} · Updated {formatDateTime(r.updated_at)} ·{" "}
                <Link href={`/track-request?ticket=${encodeURIComponent(r.request_number)}`} className="font-bold text-[#11b8d0]">
                  Full history
                </Link>
              </p>
            </div>
          ))
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-bold">My Complaints</h2>
        {(complaints.data ?? []).length === 0 ? (
          <p className={`${card} text-sm text-black/55`}>No complaints. We hope it stays that way!</p>
        ) : (
          (complaints.data ?? []).map((c) => (
            <div key={c.id} className={card}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs font-bold text-black/50">{c.complaint_number}</p>
                  <p className="mt-1 font-bold">{c.category}</p>
                  <p className="text-sm text-black/55">
                    {[c.reference_number && `Bill ${c.reference_number}`, c.store_name, c.involved_staff_name && `Staff: ${c.involved_staff_name}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <StatusBadge status={c.status} label={customerComplaintStatus(c.status, complaintKind(c.category))} />
              </div>
              {c.resolution_notes && <p className="mt-3 rounded-2xl bg-[#f7f9fb] p-3 text-sm">{c.resolution_notes}</p>}
              {c.status === "resolved" && !confirmedComplaint(c.id) ? (
                <a href={feedbackLink("complaint", c.id)} className="mt-3 inline-block rounded-xl bg-[#ff5e79] px-3 py-2 text-xs font-bold text-white">
                  Is it solved? Confirm &amp; rate
                </a>
              ) : (
                ["resolved", "closed"].includes(c.status) &&
                !rated("complaint", c.id) && (
                  <a href={feedbackLink("complaint", c.id)} className={`mt-3 inline-block ${rateButton}`}>
                    ★ Rate how we handled it
                  </a>
                )
              )}
              <p className="mt-3 text-xs text-black/45">
                Raised {formatDateTime(c.created_at)} · Updated {formatDateTime(c.updated_at)} ·{" "}
                <Link href={`/track-request?ticket=${encodeURIComponent(c.complaint_number)}`} className="font-bold text-[#11b8d0]">
                  Full history
                </Link>
              </p>
            </div>
          ))
        )}
      </section>

      <section id="special-dates" className="mt-8 space-y-3">
        <h2 className="text-xl font-bold">Our special dates 🎉</h2>
        <div className={card}>
          <p className="mb-4 text-sm text-black/55">
            Tell us your little one&apos;s birthday and other family celebrations — we&apos;ll remember them with wishes and offers.
          </p>
          <FamilyDatesEditor initial={family} />
        </div>
      </section>
    </PageShell>
  );
}
