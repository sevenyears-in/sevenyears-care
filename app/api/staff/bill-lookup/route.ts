import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { isISODate } from "@/lib/helpers";
import { buildWarrantyRows } from "@/lib/warranty-rules";
import { fetchBill, ZohoError } from "@/lib/zoho";

// POST /api/staff/bill-lookup  { billNumber, billDate }
// Fetches the bill from Zoho POS and returns one row per warranty-eligible unit.

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const billNumber = String(body.billNumber ?? "").trim();
    const billDate = String(body.billDate ?? "").trim();

    if (!billNumber) {
      return NextResponse.json({ error: "Enter the bill number." }, { status: 400 });
    }
    if (!isISODate(billDate)) {
      return NextResponse.json({ error: "Select the bill date." }, { status: 400 });
    }

    const bill = await fetchBill(billNumber, billDate);
    const { rows, ineligible, categoriesConfigured } = await buildWarrantyRows(bill);

    return NextResponse.json({
      bill: {
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        storeName: bill.storeName ?? auth.staff.storeName,
        customer: bill.customer,
        demo: bill.demo,
      },
      rows,
      ineligible,
      categoriesConfigured,
    });
  } catch (error) {
    if (error instanceof ZohoError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Bill lookup error:", error);
    return NextResponse.json(
      { error: "Unable to fetch the bill. Please try again." },
      { status: 500 }
    );
  }
}
