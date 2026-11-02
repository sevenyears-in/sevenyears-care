import { after, NextResponse } from "next/server";
import { createComplaint } from "@/lib/complaints";

// POST /api/complaints — anyone can raise a complaint from the website (no warranty needed).

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const result = await createComplaint({
      fullName: String(body.fullName ?? ""),
      mobile: String(body.mobileNumber ?? ""),
      email: String(body.email ?? ""),
      storeName: String(body.storeName ?? ""),
      category: String(body.category ?? ""),
      reference: String(body.reference ?? ""),
      description: String(body.description ?? ""),
      source: "web",
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    // Alert the store manager, HR Head, Operations Manager and CRE; confirm to the customer.
    after(result.announce);

    return NextResponse.json(
      {
        success: true,
        complaint: {
          complaint_number: result.complaintNumber,
          status: result.status,
          created_at: result.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Complaint error:", error);
    return NextResponse.json({ error: "Unable to register the complaint. Please try again." }, { status: 500 });
  }
}
