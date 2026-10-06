import Image from "next/image";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function WarrantyCertificatePage({
  params,
}: PageProps) {
  const { token } = await params;

  const { data: warranty, error } = await supabaseAdmin
    .from("warranty_registrations")
    .select(`
      warranty_number,
      warranty_start_date,
      warranty_expiry_date,
      status,
      serial_number,
      registered_at,

      customers (
        full_name,
        mobile_number,
        email
      ),

      stores (
        store_name
      ),

      products (
        product_name,
        sku,
        model_number,
        brands (
          brand_name
        )
      ),

      purchases (
        invoice_number,
        invoice_date
      )
    `)
    .eq("verification_token", token)
    .single();

  if (error || !warranty) {
    console.error("Warranty certificate error:", error);
    notFound();
  }

  const customer = Array.isArray(warranty.customers)
    ? warranty.customers[0]
    : warranty.customers;

  const store = Array.isArray(warranty.stores)
    ? warranty.stores[0]
    : warranty.stores;

  const product = Array.isArray(warranty.products)
    ? warranty.products[0]
    : warranty.products;

  const purchase = Array.isArray(warranty.purchases)
    ? warranty.purchases[0]
    : warranty.purchases;

  const brand = Array.isArray(product?.brands)
    ? product.brands[0]
    : product?.brands;

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
                <p className="mt-2 text-lg font-bold">
                  Seven Years Care
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8">
            <div className="rounded-3xl bg-[#161616] p-6 text-white">
              <p className="text-xs uppercase tracking-wider text-white/50">
                Warranty Number
              </p>

              <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
                {warranty.warranty_number}
              </h1>

              <div className="mt-6 flex flex-wrap gap-3">
                <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold uppercase text-green-300">
                  {warranty.status}
                </span>

                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                  Verified Seven Years Warranty
                </span>
              </div>
            </div>

            <section className="mt-8">
              <h2 className="text-lg font-bold">
                Customer Details
              </h2>

              <div className="mt-4 grid gap-4 rounded-2xl bg-[#f7f9fb] p-5 sm:grid-cols-2">
                <Detail
                  label="Customer Name"
                  value={customer?.full_name}
                />

                <Detail
                  label="Mobile Number"
                  value={
                    customer?.mobile_number
                      ? `+91 ${customer.mobile_number}`
                      : null
                  }
                />

                <Detail
                  label="Email"
                  value={customer?.email || "Not provided"}
                />
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-bold">
                Product Details
              </h2>

              <div className="mt-4 grid gap-4 rounded-2xl border border-black/5 p-5 sm:grid-cols-2">
                <Detail
                  label="Product"
                  value={product?.product_name}
                />

                <Detail
                  label="Brand"
                  value={brand?.brand_name}
                />

                <Detail
                  label="SKU"
                  value={product?.sku || "Not applicable"}
                />

                <Detail
                  label="Model"
                  value={product?.model_number || "Not applicable"}
                />

                <Detail
                  label="Serial Number"
                  value={
                    warranty.serial_number ||
                    "Not applicable"
                  }
                />
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-bold">
                Purchase Details
              </h2>

              <div className="mt-4 grid gap-4 rounded-2xl bg-[#f7f9fb] p-5 sm:grid-cols-2">
                <Detail
                  label="Invoice Number"
                  value={purchase?.invoice_number}
                />

                <Detail
                  label="Purchase Date"
                  value={formatDate(
                    purchase?.invoice_date
                  )}
                />

                <Detail
                  label="Purchased From"
                  value={store?.store_name}
                />
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-bold">
                Warranty Validity
              </h2>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-black/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
                    Warranty Start
                  </p>

                  <p className="mt-2 text-lg font-bold">
                    {formatDate(
                      warranty.warranty_start_date
                    )}
                  </p>
                </div>

                <div className="rounded-2xl border border-black/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
                    Warranty Expiry
                  </p>

                  <p className="mt-2 text-lg font-bold">
                    {formatDate(
                      warranty.warranty_expiry_date
                    )}
                  </p>
                </div>
              </div>
            </section>

            <div className="mt-8 rounded-2xl border border-[#11b8d0]/20 bg-[#11b8d0]/5 p-5">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#11b8d0] font-bold text-white">
                  ✓
                </div>

                <div>
                  <p className="font-bold">
                    Certificate Verified
                  </p>

                  <p className="mt-1 text-sm leading-6 text-black/60">
                    This certificate was retrieved directly
                    from the official Seven Years Care
                    warranty system.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 border-t border-black/5 pt-6 text-center">
              <p className="text-xs leading-5 text-black/40">
                Seven Years Care • Digital Warranty Certificate
              </p>

              <p className="mt-1 text-xs text-black/40">
                Keep this certificate for future warranty
                and service support.
              </p>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-black/40">
        {label}
      </p>

      <p className="mt-1 font-semibold">
        {value || "—"}
      </p>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";

  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}