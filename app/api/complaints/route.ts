import { after, NextResponse } from "next/server";
import { createComplaint } from "@/lib/complaints";
import { ensureCustomerAccountFromRequest, getCurrentCustomer } from "@/lib/customer-auth";

// POST /api/complaints — raise a complaint from the website or the customer portal.
// The invoice (bill) or warranty number is required.

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const customer = await getCurrentCustomer();

    // Logged in: name and mobile come from their account.
    const fullName = customer ? String(body.fullName ?? "").trim() || customer.name || "" : String(body.fullName ?? "");
    const mobile = customer ? customer.mobile : String(body.mobileNumber ?? "");
    const email = customer ? String(body.email ?? "").trim() || customer.email || "" : String(body.email ?? "");

    const result = await createComplaint({
      fullName,
      mobile,
      email,
      storeName: String(body.storeName ?? ""),
      category: String(body.category ?? ""),
      reference: String(body.reference ?? ""),
      description: String(body.description ?? ""),
      source: "web",
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    // Alert the store manager, HR Head, Operations Manager and CRE; ask the staff on the bill to explain.
    after(result.announce);

    // First request from this mobile: give them a My Account login.
    const account = customer
      ? { created: false }
      : await ensureCustomerAccountFromRequest(mobile.replace(/\D/g, "").slice(-10), fullName.trim(), email || null);

    return NextResponse.json(
      {
        success: true,
        complaint: {
          complaint_number: result.complaintNumber,
          status: result.status,
          created_at: result.createdAt,
          staff_name: result.staffName,
          store_name: result.storeName,
        },
        account: account.created ? { created: true } : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Complaint error:", error);
    return NextResponse.json({ error: "Unable to register the complaint. Please try again." }, { status: 500 });
  }
}
