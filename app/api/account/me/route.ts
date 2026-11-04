import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";

// GET /api/account/me — the logged-in customer and their warranties (to prefill forms).
export async function GET() {
  const customer = await getCurrentCustomer();
  if (!customer) return NextResponse.json({ loggedIn: false }, { headers: { "Cache-Control": "no-store" } });

  const { data } = await supabaseAdmin
    .from("warranties")
    .select("warranty_number, bill_number, bill_date, product_name, model_number, serial_number, store_name, warranty_expiry_date, status, customer_name, customer_address")
    .or(`customer_mobile.eq.${customer.mobile},alternate_mobile.eq.${customer.mobile}`)
    .order("bill_date", { ascending: false });

  const today = todayISO();
  return NextResponse.json(
    {
      loggedIn: true,
      mobile: customer.mobile,
      name: customer.name ?? data?.[0]?.customer_name ?? "",
      email: customer.email ?? "",
      address: data?.[0]?.customer_address ?? "",
      warranties: (data ?? []).map((w) => ({
        warrantyNumber: w.warranty_number,
        billNumber: w.bill_number,
        billDate: w.bill_date,
        productName: w.product_name,
        modelNumber: w.model_number,
        serialNumber: w.serial_number,
        storeName: w.store_name,
        active: w.status === "active" && w.warranty_expiry_date >= today,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
