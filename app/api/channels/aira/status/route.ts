import { NextResponse } from "next/server";
import { airaGuard } from "@/lib/aira";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cleanMobile, isValidMobile, statusLabel } from "@/lib/helpers";
import { customerTrackLink } from "@/lib/notify";

// GET /api/channels/aira/status?mobile=9876543210[&ticket=SY-CMP-…]
// The customer's latest service requests and complaints (or one ticket).
export async function GET(request: Request) {
  const denied = await airaGuard(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const mobile = cleanMobile(url.searchParams.get("mobile"));
  const ticket = (url.searchParams.get("ticket") ?? "").trim().toUpperCase();
  if (!isValidMobile(mobile)) return NextResponse.json({ error: "Give the customer's 10-digit mobile number." }, { status: 400 });

  const [services, complaints] = await Promise.all([
    supabaseAdmin
      .from("service_requests")
      .select("request_number, issue_type, product_name, status, resolution_notes, created_at, updated_at")
      .eq("contact_mobile", mobile)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("complaints")
      .select("complaint_number, category, status, resolution_notes, created_at, updated_at")
      .eq("contact_mobile", mobile)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const items = [
    ...(services.data ?? []).map((s) => ({
      type: "service",
      number: s.request_number,
      title: `${s.product_name ?? "Product"} — ${s.issue_type}`,
      status: s.status,
      statusText: statusLabel(s.status),
      latestUpdate: s.resolution_notes,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      trackUrl: customerTrackLink(s.request_number),
    })),
    ...(complaints.data ?? []).map((c) => ({
      type: "complaint",
      number: c.complaint_number,
      title: c.category,
      status: c.status,
      statusText: statusLabel(c.status),
      latestUpdate: c.resolution_notes,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      trackUrl: customerTrackLink(c.complaint_number),
    })),
  ].filter((i) => !ticket || i.number === ticket);

  return NextResponse.json({ mobile, items });
}
