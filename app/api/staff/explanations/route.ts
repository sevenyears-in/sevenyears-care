import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { answerExplanation, canRequestExplanation, requestExplanation } from "@/lib/explanations";
import { canViewTicket, getTicket } from "@/lib/tickets";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CORPORATE_OFFICE_NAME, sameStore } from "@/lib/roles";

// POST  { type, ticketId, staffId, reason } → ask a staff member to explain
// PATCH { id, explanation }                 → the staff member replies

export async function POST(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  if (!canRequestExplanation(auth.staff.role)) {
    return NextResponse.json({ error: "You can't ask for explanations." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type === "service" ? "service" : "complaint";
  const ticket = await getTicket(type, String(body.ticketId ?? ""));
  if (!ticket || !canViewTicket(auth.staff, type, ticket)) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  // Only the staff of this store (or Corporate Office) can be asked.
  const staffId = String(body.staffId ?? "");
  const { data: person } = await supabaseAdmin.from("staff_users").select("store_name").eq("id", staffId).maybeSingle();
  if (
    person &&
    person.store_name &&
    !sameStore(person.store_name, CORPORATE_OFFICE_NAME) &&
    !sameStore(person.store_name, ticket.storeName) &&
    staffId !== ticket.involvedStaffId
  ) {
    return NextResponse.json({ error: "Choose a staff member of this store or of the Corporate Office." }, { status: 400 });
  }
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 5) return NextResponse.json({ error: "Write what they should explain." }, { status: 400 });

  const result = await requestExplanation({
    ticketType: type,
    ticketId: ticket.id,
    ticketNumber: ticket.number,
    staffId: String(body.staffId ?? ""),
    reason,
    requestedBy: auth.staff,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
  const auth = await requireStaff();
  if (auth.response) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await answerExplanation(auth.staff, String(body.id ?? ""), String(body.explanation ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
