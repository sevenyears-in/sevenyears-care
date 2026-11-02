import { after, NextResponse } from "next/server";
import { airaGuard } from "@/lib/aira";
import { createComplaint, pickCategory } from "@/lib/complaints";
import { customerTrackLink } from "@/lib/notify";

// POST /api/channels/aira/complaints — the Aira chatbot registers a complaint.
// Header:  X-API-Key: <key from Staff → Complaint Channels>
// Body:    { name, mobile, reference (bill or warranty no.), description, category?, email? }
// Returns: { complaintNumber, status, trackUrl }
export async function POST(request: Request) {
  const denied = await airaGuard(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createComplaint({
    fullName: String(body.name ?? body.fullName ?? ""),
    mobile: String(body.mobile ?? body.mobileNumber ?? ""),
    email: String(body.email ?? ""),
    storeName: String(body.store ?? body.storeName ?? ""),
    category: pickCategory(String(body.category ?? "")),
    reference: String(body.reference ?? body.billNumber ?? ""),
    description: String(body.description ?? body.message ?? ""),
    source: "aira",
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  after(result.announce);

  return NextResponse.json(
    {
      success: true,
      complaintNumber: result.complaintNumber,
      staffName: result.staffName,
      storeName: result.storeName,
      status: result.status,
      trackUrl: customerTrackLink(result.complaintNumber),
      message: `Your complaint ${result.complaintNumber} has been registered. Our team will contact you within 2 working hours.`,
    },
    { status: 201 }
  );
}
