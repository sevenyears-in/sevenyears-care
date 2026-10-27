import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDate } from "@/lib/helpers";
import { EXTENDED_WARRANTY } from "@/lib/site-config";
import { WARRANTY_TERMS } from "@/lib/certificate-pdf";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function WarrantyCertificatePage({ params }: PageProps) {
  const { token } = await params;

  if (!/^[a-f0-9]{16,64}$/i.test(token)) notFound();

  const { data: w, error } = await supabaseAdmin
    .from("warranties")
    .select(
      "warranty_number, verification_token, bill_number, bill_date, store_name, product_name, sku, category_name, model_number, serial_number, customer_name, customer_mobile, customer_address, warranty_start_date, standard_warranty_expiry_date, extended_warranty_purchased, extended_warranty_start_date, extended_warranty_expiry_date, warranty_expiry_date, status"
    )
    .eq("verification_token", token)
    .maybeSingle();

  if (error) console.error("Warranty certificate error:", error);
  if (!w) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const expired = w.warranty_expiry_date < today;
  const statusText = w.status !== "active" ? "Void" : expired ? "Expired" : "Active";
  const statusClass =
    statusText === "Active" ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300";

  // Show only the last 4 digits of the mobile on the public page.
  const maskedMobile = w.customer_mobile ? `+91 ••••••${w.customer_mobile.slice(-4)}` : "—";

  return (
    <main className="min-h-screen bg-[#f5f7f9] px-4 py-8 text-[#161616]">
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-3xl bg-white shadow-lg ring-1 ring-black/5">
          <div className="border-b border-black/5 p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <Image
                src="/seven-years-logo.png"
                alt="Seven Years"
                width={190}
                height={80}
                className="h-auto w-[170px] object-contain"
                priority
              />
              <div className="sm:text-right">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">
                  Digital Warranty Certificate
                </p>
                <p className="mt-2 text-lg font-bold">Seven Years Care</p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="rounded-3xl bg-[#161616] p-6 text-white">
              <p className="text-xs uppercase tracking-wider text-white/50">Warranty Number</p>
              <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{w.warranty_number}</h1>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusClass}`}>
                  {statusText}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                  Covered until {formatDate(w.warranty_expiry_date)}
                </span>
              </div>
            </div>

            <Section title="Customer">
              <Detail label="Name" value={w.customer_name} />
              <Detail label="Mobile" value={maskedMobile} />
            </Section>

            <Section title="Product" bordered>
              <Detail label="Product" value={w.product_name} />
              <Detail label="Category" value={w.category_name} />
              <Detail label="Model Number" value={w.model_number} />
              <Detail label="Serial Number" value={w.serial_number} />
            </Section>

            <Section title="Purchase">
              <Detail label="Bill Number" value={w.bill_number} />
              <Detail label="Bill Date" value={formatDate(w.bill_date)} />
              <Detail label="Purchased From" value={w.store_name ?? "Seven Years"} />
            </Section>

            <section className="mt-8">
              <h2 className="text-lg font-bold">Coverage</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-black/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
                    Standard Warranty
                  </p>
                  <p className="mt-2 font-bold">
                    {formatDate(w.warranty_start_date)} – {formatDate(w.standard_warranty_expiry_date)}
                  </p>
                </div>
                <div
                  className={`rounded-2xl border p-5 ${
                    w.extended_warranty_purchased ? "border-[#ff5e79]/30 bg-[#ff5e79]/5" : "border-black/5"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
                    Extended Warranty
                  </p>
                  <p className="mt-2 font-bold">
                    {w.extended_warranty_purchased
                      ? `${formatDate(w.extended_warranty_start_date)} – ${formatDate(w.extended_warranty_expiry_date)}`
                      : "Not purchased"}
                  </p>
                  {w.extended_warranty_purchased && (
                    <p className="mt-1 text-xs text-black/50">{EXTENDED_WARRANTY.feeLabel} plan</p>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-8 rounded-2xl bg-[#f7f9fb] p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-black/50">Warranty Terms</h2>
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-black/70">
                {WARRANTY_TERMS.map((term) => (
                  <li key={term}>{term}</li>
                ))}
              </ol>
            </section>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`/api/certificate/${w.verification_token}/pdf`}
                className="rounded-2xl bg-[#161616] px-5 py-3 text-center text-sm font-bold text-white transition hover:opacity-90"
              >
                Download PDF Certificate
              </a>
              <Link
                href={`/request-service?warranty=${encodeURIComponent(w.warranty_number)}`}
                className="rounded-2xl border border-black/10 px-5 py-3 text-center text-sm font-bold transition hover:bg-[#f7f9fb]"
              >
                Request Service
              </Link>
              <Link
                href="/"
                className="rounded-2xl px-5 py-3 text-center text-sm font-bold text-black/50 hover:text-black"
              >
                Seven Years Care Home
              </Link>
            </div>

            <div className="mt-8 rounded-2xl border border-[#11b8d0]/20 bg-[#11b8d0]/5 p-5">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#11b8d0] font-bold text-white">
                  ✓
                </div>
                <div>
                  <p className="font-bold">Certificate Verified</p>
                  <p className="mt-1 text-sm leading-6 text-black/60">
                    This certificate was retrieved directly from the official Seven Years Care
                    warranty system.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  bordered = false,
  children,
}: {
  title: string;
  bordered?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">{title}</h2>
      <div
        className={`mt-4 grid gap-4 rounded-2xl p-5 sm:grid-cols-2 ${
          bordered ? "border border-black/5" : "bg-[#f7f9fb]"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-black/40">{label}</p>
      <p className="mt-1 font-semibold">{value || "—"}</p>
    </div>
  );
}
