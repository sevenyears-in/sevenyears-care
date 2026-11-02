import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/SiteChrome";
import { ResetCustomerLogin } from "@/components/ResetCustomerLogin";
import { formatDate, formatDateTime, one, statusLabel, todayISO } from "@/lib/helpers";

// Staff: full details of one warranty (opened from Warranties → View).

type Row = {
  id: string;
  warranty_number: string;
  verification_token: string;
  bill_number: string;
  bill_date: string;
  store_name: string | null;
  product_name: string;
  sku: string | null;
  category_name: string | null;
  model_number: string;
  serial_number: string;
  customer_name: string;
  customer_mobile: string;
  customer_address: string;
  warranty_start_date: string;
  standard_warranty_expiry_date: string;
  extended_warranty_purchased: boolean;
  extended_warranty_fee: number | null;
  extended_warranty_start_date: string | null;
  extended_warranty_expiry_date: string | null;
  warranty_expiry_date: string;
  status: string;
  created_at: string;
  staff_users: { full_name: string; user_id: string } | { full_name: string; user_id: string }[] | null;
};

export default async function WarrantyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data, error } = await supabaseAdmin
    .from("warranties")
    .select(
      "id, warranty_number, verification_token, bill_number, bill_date, store_name, product_name, sku, category_name, model_number, serial_number, customer_name, customer_mobile, customer_address, warranty_start_date, standard_warranty_expiry_date, extended_warranty_purchased, extended_warranty_fee, extended_warranty_start_date, extended_warranty_expiry_date, warranty_expiry_date, status, created_at, staff_users:registered_by (full_name, user_id)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error("Warranty detail error:", error);
  if (!data) notFound();

  const w = data as unknown as Row;
  const registeredBy = one(w.staff_users);
  const status = w.status === "active" && w.warranty_expiry_date < todayISO() ? "expired" : w.status;

  const sections: { title: string; rows: { label: string; value: string | null }[] }[] = [
    {
      title: "Customer",
      rows: [
        { label: "Name", value: w.customer_name },
        { label: "Mobile", value: w.customer_mobile ? `+91 ${w.customer_mobile}` : null },
        { label: "Address", value: w.customer_address },
      ],
    },
    {
      title: "Product",
      rows: [
        { label: "Product", value: w.product_name },
        { label: "Category", value: w.category_name },
        { label: "Model number", value: w.model_number },
        { label: "Serial number", value: w.serial_number },
        { label: "SKU", value: w.sku },
      ],
    },
    {
      title: "Purchase",
      rows: [
        { label: "Bill number", value: w.bill_number },
        { label: "Bill date", value: formatDate(w.bill_date) },
        { label: "Store", value: w.store_name },
      ],
    },
    {
      title: "Coverage",
      rows: [
        { label: "Warranty starts", value: formatDate(w.warranty_start_date) },
        { label: "Standard warranty until", value: formatDate(w.standard_warranty_expiry_date) },
        {
          label: "Extended warranty",
          value: w.extended_warranty_purchased
            ? `Yes — ${formatDate(w.extended_warranty_start_date)} to ${formatDate(w.extended_warranty_expiry_date)}${
                w.extended_warranty_fee ? ` (₹${Number(w.extended_warranty_fee).toLocaleString("en-IN")})` : ""
              }`
            : "No",
        },
        { label: "Covered until", value: formatDate(w.warranty_expiry_date) },
      ],
    },
    {
      title: "Registration",
      rows: [
        { label: "Registered on", value: formatDateTime(w.created_at) },
        { label: "Registered by", value: registeredBy ? `${registeredBy.full_name} (${registeredBy.user_id})` : null },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/staff/warranties" className="text-sm font-semibold text-black/50 hover:text-black">
            ← Warranties
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-bold sm:text-3xl">{w.warranty_number}</h1>
          <div className="mt-2">
            <StatusBadge status={status} label={statusLabel(status)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/certificate/${w.verification_token}/pdf`}
            className="rounded-2xl bg-[#161616] px-4 py-3 text-sm font-bold text-white"
          >
            Download PDF Certificate
          </a>
          <a
            href={`/warranty/${w.verification_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-bold hover:bg-[#f7f9fb]"
          >
            Customer page
          </a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <div key={section.title} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
            <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">{section.title}</p>
            <dl className="mt-3 space-y-2 text-sm">
              {section.rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[150px_1fr] gap-3">
                  <dt className="text-black/50">{row.label}</dt>
                  <dd className="font-semibold break-words">{row.value || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <ResetCustomerLogin warrantyId={w.id} />
      </div>
    </div>
  );
}
