import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/SiteChrome";
import { ResetCustomerLogin } from "@/components/ResetCustomerLogin";
import { CompleteWarrantyDetails } from "@/components/CompleteWarrantyDetails";
import { ProductUserEditor } from "@/components/ProductUserEditor";
import { AdminDangerZone } from "@/components/AdminDangerZone";
import { EditWarranty } from "@/components/EditWarranty";
import { ServiceCoverageBlock } from "@/components/ServiceCoverageBlock";
import { SetServiceCoverage } from "@/components/SetServiceCoverage";
import { isServiceCoverage } from "@/lib/warranty-coverage";
import { warrantyEditLevel } from "@/lib/warranty-edit";
import { loadActiveCategories } from "@/lib/warranty-rules";
import { formatDate, formatDateTime, one, statusLabel, todayISO } from "@/lib/helpers";

// Staff: full details of one warranty (opened from Warranties → View).

type Row = {
  id: string;
  warranty_number: string;
  verification_token: string;
  bill_number: string;
  bill_date: string;
  store_name: string | null;
  service_coverage: string | null;
  product_name: string;
  sku: string | null;
  category_name: string | null;
  model_number: string;
  serial_number: string;
  alternate_name: string | null;
  alternate_mobile: string | null;
  void_reason: string | null;
  voided_by: string | null;
  edited_at?: string | null;
  edited_by?: string | null;
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

  const COLS =
    "id, warranty_number, verification_token, bill_number, bill_date, store_name, product_name, sku, category_name, model_number, serial_number, customer_name, customer_mobile, customer_address, alternate_name, alternate_mobile, void_reason, voided_by, warranty_start_date, standard_warranty_expiry_date, extended_warranty_purchased, extended_warranty_fee, extended_warranty_start_date, extended_warranty_expiry_date, warranty_expiry_date, status, created_at, service_coverage, staff_users:registered_by (full_name, user_id)";
  const first = await supabaseAdmin.from("warranties").select(`${COLS}, edited_at, edited_by`).eq("id", id).maybeSingle();
  const { data, error } = first.error ? await supabaseAdmin.from("warranties").select(COLS).eq("id", id).maybeSingle() : first;

  if (error) console.error("Warranty detail error:", error);
  if (!data) notFound();

  const w = data as unknown as Row;
  const registeredBy = one(w.staff_users);
  const status = w.status === "active" && w.warranty_expiry_date < todayISO() ? "expired" : w.status;
  const editLevel = await warrantyEditLevel(staff, w.store_name);
  const categories = editLevel ? [...(await loadActiveCategories().catch(() => new Map())).values()].map((c) => String(c.category_name)).sort() : [];

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
        ...(w.edited_at ? [{ label: "Last edited", value: `${formatDateTime(w.edited_at)} by ${w.edited_by ?? "—"}` }] : []),
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
          {editLevel && (
            <EditWarranty
              full={editLevel === "full"}
              categories={categories}
              w={{
                id: w.id,
                customerName: w.customer_name,
                customerMobile: w.customer_mobile,
                customerAddress: w.customer_address,
                productName: w.product_name,
                modelNumber: w.model_number,
                categoryName: w.category_name,
                serialNumber: w.serial_number,
                warrantyStartDate: w.warranty_start_date,
                standardExpiry: w.standard_warranty_expiry_date,
                coveredUntil: w.warranty_expiry_date,
              }}
            />
          )}
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
        {(w.serial_number === "Not recorded" || w.customer_address === "Not recorded") && (
          <CompleteWarrantyDetails
            id={w.id}
            model={w.model_number}
            needsSerial={w.serial_number === "Not recorded"}
            needsAddress={w.customer_address === "Not recorded"}
          />
        )}
        <div className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
          <p className="text-xs font-bold uppercase tracking-wider text-[#ff5e79]">Warranty service type</p>
          {isServiceCoverage(w.service_coverage) ? (
            <ServiceCoverageBlock coverage={w.service_coverage} store={w.store_name} className="mt-3" />
          ) : (
            <p className="mt-3 text-sm text-black/55">Not set — this warranty was issued before the service type was added. The certificate shows no service type.</p>
          )}
          {staff.role === "super_admin" && <SetServiceCoverage id={w.id} value={isServiceCoverage(w.service_coverage) ? w.service_coverage : null} />}
        </div>
        {sections.map((section) => (
          <div key={section.title} className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
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
        <ProductUserEditor id={w.id} name={w.alternate_name} mobile={w.alternate_mobile} />
        <ResetCustomerLogin warrantyId={w.id} />
        {staff.role === "super_admin" && (
          <AdminDangerZone kind="warranty" id={w.id} number={w.warranty_number} voided={w.status === "void"} voidReason={w.void_reason} />
        )}
      </div>
    </div>
  );
}
