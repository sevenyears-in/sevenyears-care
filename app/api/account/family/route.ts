import { NextResponse } from "next/server";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { cleanFamily, loadFamily, saveFamily } from "@/lib/family";

// GET / PUT /api/account/family — the logged-in customer's special dates.
export async function GET() {
  const customer = await getCurrentCustomer();
  if (!customer) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  return NextResponse.json({ family: await loadFamily(customer.mobile) });
}

export async function PUT(request: Request) {
  const customer = await getCurrentCustomer();
  if (!customer) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const parsed = cleanFamily(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const family = await saveFamily(customer.mobile, parsed.value, `customer ${customer.mobile}`);
    return NextResponse.json({ success: true, family });
  } catch (error) {
    console.error("Save family dates error:", error);
    return NextResponse.json({ error: "Could not save right now. Please try again." }, { status: 500 });
  }
}
