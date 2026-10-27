import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, isValidMobile } from "@/lib/helpers";

// POST /api/warranty/lookup
// Body: { mobileNumber, reference }
// "reference" must be a warranty number OR a bill number registered against
// this mobile number, so nobody can list a stranger's warranties with only
// a phone number.

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mobile = cleanMobile(body.mobileNumber);
    const reference = String(body.reference ?? "").trim().toUpperCase();

    if (!isValidMobile(mobile)) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit Indian mobile number." },
        { status: 400 }
      );
    }

    if (!reference) {
      return NextResponse.json(
        { error: "Enter your warranty number or bill number." },
        { status: 400 }
      );
    }

    const { data: rows, error } = await supabaseAdmin
      .from("warranties")
      .select(
        "warranty_number, verification_token, bill_number, bill_date, store_name, product_name, sku, category_name, model_number, serial_number, customer_name, warranty_start_date, warranty_expiry_date, extended_warranty_purchased, status"
      )
      .eq("customer_mobile", mobile)
      .order("bill_date", { ascending: false });

    if (error) throw error;

    const list = rows ?? [];
    const matches = list.some(
      (row) =>
        String(row.warranty_number).toUpperCase() === reference ||
        String(row.bill_number).trim().toUpperCase() === reference
    );

    if (!matches) {
      return NextResponse.json(
        {
          error:
            "We couldn't find warranties matching these details. Check the mobile number and warranty / bill number.",
        },
        { status: 404 }
      );
    }

    const today = new Date().toISOString().split("T")[0];

    return NextResponse.json({
      customerName: list[0]?.customer_name ?? "",
      warranties: list.map((row) => ({
        warrantyNumber: row.warranty_number,
        productName: row.product_name,
        categoryName: row.category_name,
        sku: row.sku,
        modelNumber: row.model_number,
        serialNumber: row.serial_number,
        storeName: row.store_name,
        billNumber: row.bill_number,
        billDate: row.bill_date,
        startDate: row.warranty_start_date,
        expiryDate: row.warranty_expiry_date,
        extended: !!row.extended_warranty_purchased,
        status:
          row.status === "active" && row.warranty_expiry_date < today ? "expired" : row.status,
        certificateToken: row.verification_token,
      })),
    });
  } catch (error) {
    console.error("Warranty lookup error:", error);
    return NextResponse.json(
      { error: "Unable to look up warranties. Please try again." },
      { status: 500 }
    );
  }
}
