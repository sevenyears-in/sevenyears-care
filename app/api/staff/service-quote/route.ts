import { after, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { canViewTicket, getTicket, isTicketManager } from "@/lib/tickets";
import { notifyCustomer } from "@/lib/notify";
import { quoteLink } from "@/lib/quote-token";

// POST /api/staff/service-quote { id, amount, note } — send the repair quote of a
// paid service request to the customer for online approval.
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const staff = auth.staff;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "");
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const note = String(body.note ?? "").trim().slice(0, 600);

  const t = await getTicket("service", id);
  if (!t || !canViewTicket(staff, "service", t)) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (!t.paid) return NextResponse.json({ error: "Quotes are only for paid service requests." }, { status: 400 });
  if (!(isTicketManager(staff, "service", t) || t.assigneeId === staff.id) || staff.role === "director") {
    return NextResponse.json({ error: "Only the store manager, service head or the technician can send the quote." }, { status: 403 });
  }
  if (["resolved", "closed", "cancelled"].includes(t.status)) {
    return NextResponse.json({ error: "This request is already finished." }, { status: 409 });
  }
  if (t.quoteStatus === "approved") return NextResponse.json({ error: "The customer has already approved a quote." }, { status: 409 });
  if (!Number.isFinite(amount) || amount < 0 || amount > 500000) return NextResponse.json({ error: "Enter the repair amount." }, { status: 400 });
  if (note.length < 5) return NextResponse.json({ error: "Write what will be repaired / replaced." }, { status: 400 });

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("service_requests")
    .update({ quote_amount: amount, quote_note: note, quote_status: "pending", quote_sent_at: now, quote_decided_at: null, quote_by: staff.fullName })
    .eq("id", t.id);
  if (error) {
    console.error("Send quote error:", error);
    return NextResponse.json({ error: "Unable to send the quote. Please try again." }, { status: 500 });
  }
  const rupees = `₹${amount.toLocaleString("en-IN")}`;
  await supabaseAdmin.from("ticket_status_history").insert({
    ticket_type: "service",
    ticket_id: t.id,
    status: t.status,
    note: `Repair quote ${rupees} sent for your approval: ${note}`,
    action: "quote",
    actor_name: staff.fullName,
    visibility: "customer",
  });

  after(() =>
    notifyCustomer({
      name: t.contactName,
      mobile: t.contactMobile,
      ticketNumber: t.number,
      message: `Your ${t.productName ?? "product"} has been inspected. Repair quote: ${rupees} — ${note}. Please approve or decline here:`,
      link: quoteLink(t.id),
    }).catch((e) => console.error("Quote message failed:", e))
  );
  return NextResponse.json({ success: true });
}
