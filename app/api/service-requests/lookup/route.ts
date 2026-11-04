import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, isValidMobile, todayISO } from "@/lib/helpers";

// POST /api/service-requests/lookup { mobile, reference }
// Mobile number (the buyer's or the product user's, as given at the store)
// + bill number or warranty number → the products that can get service.
// Names, addresses and other numbers are never returned.

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { reference?: string; mobile?: string };
  const ref = String(body.reference ?? "").toUpperCase().replace(/[^A-Z0-9\-/]/g, "").slice(0, 60);
  const mobile = cleanMobile(body.mobile);
  if (!isValidMobile(mobile)) {
    return NextResponse.json({ error: "Enter the 10-digit mobile number given at the store." }, { status: 400 });
  }
  if (ref.length < 4) {
    return NextResponse.json({ error: "Enter the bill number or warranty number." }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("warranties")
    .select("warranty_number, bill_number, bill_date, product_name, model_number, serial_number, store_name, warranty_expiry_date, status, customer_mobile, alternate_mobile")
    .or(`warranty_number.eq.${ref},bill_number.ilike.${ref}`)
    .order("product_name")
    .limit(30);
  if (error) {
    console.error("Service lookup error:", error);
    return NextResponse.json({ error: "Unable to look up the bill. Please try again." }, { status: 500 });
  }
  const mine = (data ?? []).filter((w) => w.customer_mobile === mobile || w.alternate_mobile === mobile);
  if (!mine.length) {
    return NextResponse.json(
      {
        error: data?.length
          ? "This mobile number doesn't match the one given at the store for this bill. Use the buyer's or the product user's number — or call the store / raise a complaint and our team will update it."
          : "We couldn't find a registered warranty for this number. Check the bill / warranty number (e.g. VDK26-SI1-8504 or SY-WAR-2026-123456), or raise a complaint and our team will help.",
      },
      { status: 404 }
    );
  }
  const today = todayISO();
  return NextResponse.json({
    items: mine.map((w) => ({
      warrantyNumber: w.warranty_number,
      productName: w.product_name,
      model: w.model_number,
      serialEnd: w.serial_number && w.serial_number !== "Not recorded" ? String(w.serial_number).slice(-4) : "",
      store: w.store_name,
      billDate: w.bill_date,
      active: w.status === "active",
      underWarranty: w.status === "active" && w.warranty_expiry_date >= today,
    })),
  });
}
