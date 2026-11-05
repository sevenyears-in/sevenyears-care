import { after, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readQuoteToken } from "@/lib/quote-token";
import { findRecipients, findStaffByIds, notifyStaff } from "@/lib/notify";

// POST /api/service-quote { token, decision: "approve" | "decline" } — the customer's answer.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { token?: string; decision?: string };
  const id = readQuoteToken(String(body.token ?? ""));
  if (!id) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const decision = body.decision === "approve" ? "approved" : body.decision === "decline" ? "declined" : null;
  if (!decision) return NextResponse.json({ error: "Choose Approve or Decline." }, { status: 400 });

  const { data: changed, error } = await supabaseAdmin
    .from("service_requests")
    .update({ quote_status: decision, quote_decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("quote_status", "pending")
    .select("id, request_number, store_name, product_name, quote_amount, status, assigned_technician_id, contact_name")
    .maybeSingle();
  if (error) {
    console.error("Quote decision error:", error);
    return NextResponse.json({ error: "Unable to save. Please try again." }, { status: 500 });
  }
  if (!changed) return NextResponse.json({ error: "This quote has already been answered." }, { status: 409 });

  const rupees = `₹${Number(changed.quote_amount ?? 0).toLocaleString("en-IN")}`;
  await supabaseAdmin.from("ticket_status_history").insert({
    ticket_type: "service",
    ticket_id: id,
    status: changed.status,
    note: decision === "approved" ? `You approved the repair quote of ${rupees}. We will start the work.` : `You declined the repair quote of ${rupees}.`,
    action: "quote_decision",
    actor_name: changed.contact_name ?? "Customer",
    visibility: "customer",
  });

  after(async () => {
    const people = [
      ...(await findStaffByIds([changed.assigned_technician_id])),
      ...(await findRecipients(["store_manager", "service_head"], changed.store_name)),
    ];
    await notifyStaff(people, {
      ticketType: "service",
      ticketId: id,
      ticketNumber: changed.request_number,
      title: decision === "approved" ? "Quote approved — start the repair" : "Quote declined by the customer",
      summary: `${changed.product_name ?? "Product"} · ${rupees}`,
      storeName: changed.store_name,
    }).catch((e) => console.error("Quote decision alert failed:", e));
  });

  return NextResponse.json({ success: true, decision });
}
