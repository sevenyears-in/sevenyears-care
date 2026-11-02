import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PageShell, StatusBadge } from "@/components/SiteChrome";
import { CustomerLogoutButton } from "@/components/CustomerLogoutButton";
import { formatDate, formatDateTime, statusLabel, todayISO } from "@/lib/helpers";

export const metadata = { title: "My Account" };

// Customer portal: warranties, service requests and complaints for the logged-in mobile number.
export default async function AccountPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/account/login");

  const [warranties, services, complaints] = await Promise.all([
    supabaseAdmin
      .from("warranties")
      .select(
        "id, warranty_number, verification_token, product_name, model_number, serial_number, bill_number, bill_date, store_name, warranty_expiry_date, extended_warranty_purchased, status"
      )
      .eq("customer_mobile", customer.mobile)
      .order("bill_date", { ascending: false }),
    supabaseAdmin
      .from("service_requests")
      .select("id, request_number, product_name, issue_type, status, resolution_notes, created_at, updated_at")
      .eq("contact_mobile", customer.mobile)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("complaints")
      .select("id, complaint_number, category, status, resolution_notes, created_at, updated_at")
      .eq("contact_mobile", customer.mobile)
      .order("created_at", { ascending: false }),
  ]);

  const today = todayISO();
  const card = "rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6";

  return (
    <PageShell
      eyebrow="My Account"
      title={`Hello${customer.name ? `, ${customer.name}` : ""}`}
      intro={`Logged in with +91 ${customer.mobile}.`}
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/request-service" className="rounded-2xl bg-[#ff5e79] px-4 py-2.5 text-sm font-bold text-white">
          Request Service
        </Link>
        <Link href="/register-complaint" className="rounded-2xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white">
          Register a Complaint
        </Link>
        <Link href="/account/password" className="rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-sm font-bold">
          Change Password
        </Link>
        <CustomerLogoutButton />
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-bold">My Warranties</h2>
        {(warranties.data ?? []).length === 0 ? (
          <p className={`${card} text-sm text-black/55`}>No warranties found for this mobile number.</p>
        ) : (
          (warranties.data ?? []).map((w) => {
            const status = w.status !== "active" ? "void" : w.warranty_expiry_date < today ? "expired" : "active";
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
                </div>
              </div>
            );
          })
        )}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-xl font-bold">My Service Requests</h2>
        {(services.data ?? []).length === 0 ? (
          <p className={`${card} text-sm text-black/55`}>No service requests yet.</p>
        ) : (
          (services.data ?? []).map((r) => (
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
                </div>
                <StatusBadge status={c.status} label={statusLabel(c.status)} />
              </div>
              {c.resolution_notes && <p className="mt-3 rounded-2xl bg-[#f7f9fb] p-3 text-sm">{c.resolution_notes}</p>}
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
    </PageShell>
  );
}
