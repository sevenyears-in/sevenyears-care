import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { answerExplanation, canRequestExplanation, manageExplanation, requestExplanation } from "@/lib/explanations";
import { canViewTicket, getTicket } from "@/lib/tickets";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CORPORATE_OFFICE_NAME, isCorporateStaff, sameStore } from "@/lib/roles";

// POST  { type, ticketId, staffId, reason } → ask a staff member to explain
// PATCH { id, explanation }                 → the staff member replies
// PATCH { id, action: "remind" }            → send the staff member a reminder
// PATCH { id, action: "record", text }      → HR / manager records what they said in person
// PATCH { id, action: "withdraw", text }    → no longer needed

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
    !isCorporateStaff(auth.staff) &&
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
  const manage = body.action === "remind" || body.action === "record" || body.action === "withdraw";
  if (manage) {
    // Only people who can open the complaint / request can manage its explanations.
    const { data: row } = await supabaseAdmin
      .from("ticket_explanations")
      .select("ticket_type, ticket_id")
      .eq("id", String(body.id ?? ""))
      .maybeSingle();
    const ttype = row?.ticket_type === "service" ? "service" : "complaint";
    const ticket = row ? await getTicket(ttype, String(row.ticket_id)) : null;
    if (!ticket || !canViewTicket(auth.staff, ttype, ticket)) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
  }
  const result = manage
    ? await manageExplanation(auth.staff, String(body.id ?? ""), body.action as "remind" | "record" | "withdraw", String(body.text ?? ""))
    : await answerExplanation(auth.staff, String(body.id ?? ""), String(body.explanation ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ success: true });
}
