import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { todayISO } from "@/lib/helpers";

// POST /api/service-requests/lookup { reference }
// Mobile number (buyer's or the gift user's), bill number or warranty number
// → the products that can get service.
// The buyer's name and mobile are never returned (the product may be a gift).

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { reference?: string };
  const raw = String(body.reference ?? "").trim();
  const ref = raw.toUpperCase().replace(/[^A-Z0-9\-/]/g, "").slice(0, 60);
  if (ref.length < 4) {
    return NextResponse.json({ error: "Enter the mobile number, bill number or warranty number." }, { status: 400 });
  }
  // A 10-digit Indian mobile (optionally with +91 / 0 in front)
  const mobileMatch = raw.replace(/[\s\-]/g, "").match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  const columns = "warranty_number, bill_number, bill_date, product_name, model_number, serial_number, store_name, warranty_expiry_date, status";
  let query = supabaseAdmin.from("warranties").select(columns);
  if (mobileMatch) {
    const m = mobileMatch[1];
    query = query.or(`customer_mobile.eq.${m},alternate_mobile.eq.${m}`);
  } else {
    query = query.or(`warranty_number.eq.${ref},bill_number.ilike.${ref}`);
  }
  const { data, error } = await query.order("bill_date", { ascending: false }).order("product_name").limit(40);
  if (error) {
    console.error("Service lookup error:", error);
    return NextResponse.json({ error: "Unable to look up the bill. Please try again." }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json(
      {
        error:
          mobileMatch
            ? "No registered warranty has this mobile number. Try the bill number or warranty number instead (e.g. VDK26-SI1-8504 or SY-WAR-2026-123456)."
            : "We couldn't find a registered warranty for this number. Check the bill / warranty number (e.g. VDK26-SI1-8504 or SY-WAR-2026-123456), or raise a complaint and our team will help.",
      },
      { status: 404 }
    );
  }
  const today = todayISO();
  return NextResponse.json({
    items: data.map((w) => ({
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
