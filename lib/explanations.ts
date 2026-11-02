// Staff explanations (server only).
// A complaint about a sale asks the staff member who made it for their side of
// the story; Directors and managers can also ask any staff member to explain a
// delay or an SOP violation on a service request or complaint.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { StaffUser } from "@/lib/auth";
import type { TicketType } from "@/lib/sla";
import { findStaffByIds, notifyStaff, siteUrl } from "@/lib/notify";
import { isAdmin, type Role } from "@/lib/roles";

export type Explanation = {
  id: string;
  ticketType: TicketType;
  ticketId: string;
  ticketNumber: string;
  staffId: string;
  staffName: string;
  reason: string;
  requestedByName: string | null;
  requestedAt: string;
  explanation: string | null;
  explainedAt: string | null;
};

const COLS =
  "id, ticket_type, ticket_id, ticket_number, staff_id, staff_name, reason, requested_by_name, requested_at, explanation, explained_at";

function toExplanation(r: Record<string, unknown>): Explanation {
  return {
    id: String(r.id),
    ticketType: r.ticket_type === "service" ? "service" : "complaint",
    ticketId: String(r.ticket_id),
    ticketNumber: String(r.ticket_number),
    staffId: String(r.staff_id),
    staffName: String(r.staff_name ?? ""),
    reason: String(r.reason ?? ""),
    requestedByName: r.requested_by_name ? String(r.requested_by_name) : null,
    requestedAt: String(r.requested_at),
    explanation: r.explanation ? String(r.explanation) : null,
    explainedAt: r.explained_at ? String(r.explained_at) : null,
  };
}

/** Who may ask a staff member to explain. */
export function canRequestExplanation(role: Role) {
  const allowed: Role[] = ["director", "hr_head", "operations_manager", "service_head", "store_manager", "cre"];
  return isAdmin(role) || allowed.includes(role);
}

export async function requestExplanation(input: {
  ticketType: TicketType;
  ticketId: string;
  ticketNumber: string;
  staffId: string;
  reason: string;
  requestedBy: StaffUser | null;
}) {
  const [person] = await findStaffByIds([input.staffId]);
  if (!person) return { ok: false as const, error: "Choose an active staff member." };

  // One open request per person per ticket.
  const { data: open } = await supabaseAdmin
    .from("ticket_explanations")
    .select("id")
    .eq("ticket_type", input.ticketType)
    .eq("ticket_id", input.ticketId)
    .eq("staff_id", input.staffId)
    .is("explained_at", null)
    .maybeSingle();
  if (open) return { ok: false as const, error: `${person.full_name} has already been asked and hasn't replied yet.` };

  const { error } = await supabaseAdmin.from("ticket_explanations").insert({
    ticket_type: input.ticketType,
    ticket_id: input.ticketId,
    ticket_number: input.ticketNumber,
    staff_id: input.staffId,
    staff_name: person.full_name,
    reason: input.reason.slice(0, 1000),
    requested_by: input.requestedBy?.id ?? null,
    requested_by_name: input.requestedBy?.fullName ?? "System",
  });
  if (error) {
    console.error("Request explanation error:", error);
    return { ok: false as const, error: "Unable to send the request." };
  }

  await supabaseAdmin.from("ticket_status_history").insert({
    ticket_type: input.ticketType,
    ticket_id: input.ticketId,
    status: "explanation",
    note: `Explanation asked from ${person.full_name}: ${input.reason}`,
    action: "request_explanation",
    actor_id: input.requestedBy?.id ?? null,
    actor_name: input.requestedBy?.fullName ?? "System",
    visibility: "internal",
  }).then(({ error: e }) => e && console.error("History insert (explanation) error:", e));

  await notifyStaff([person], {
    ticketType: input.ticketType,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    title: "Your explanation is needed",
    summary: input.reason,
    details: [`Asked by ${input.requestedBy?.fullName ?? "Seven Years Care"}`, `Reply here: ${siteUrl()}/staff/explanations`],
    storeName: null,
  });

  return { ok: true as const };
}

export async function answerExplanation(staff: StaffUser, id: string, text: string) {
  const explanation = text.trim();
  if (explanation.length < 10) return { ok: false as const, error: "Please write your explanation (at least a sentence)." };

  const { data: row } = await supabaseAdmin.from("ticket_explanations").select(`${COLS}, requested_by`).eq("id", id).maybeSingle();
  if (!row || String(row.staff_id) !== staff.id) return { ok: false as const, error: "Request not found." };
  if (row.explained_at) return { ok: false as const, error: "You have already replied to this." };

  const { error } = await supabaseAdmin
    .from("ticket_explanations")
    .update({ explanation: explanation.slice(0, 4000), explained_at: new Date().toISOString() })
    .eq("id", id)
    .is("explained_at", null);
  if (error) {
    console.error("Answer explanation error:", error);
    return { ok: false as const, error: "Unable to save. Please try again." };
  }

  const e = toExplanation(row);
  await supabaseAdmin.from("ticket_status_history").insert({
    ticket_type: e.ticketType,
    ticket_id: e.ticketId,
    status: "explanation",
    note: `Explanation from ${staff.fullName}: ${explanation}`,
    action: "explanation",
    actor_id: staff.id,
    actor_name: staff.fullName,
    visibility: "internal",
  }).then(({ error: err }) => err && console.error("History insert (answer) error:", err));

  if (row.requested_by) {
    const people = await findStaffByIds([String(row.requested_by)]);
    await notifyStaff(people, {
      ticketType: e.ticketType,
      ticketId: e.ticketId,
      ticketNumber: e.ticketNumber,
      title: `Explanation received from ${staff.fullName}`,
      summary: explanation.slice(0, 300),
      storeName: null,
    });
  }
  return { ok: true as const };
}

export async function explanationsForTicket(type: TicketType, ticketId: string) {
  const { data } = await supabaseAdmin
    .from("ticket_explanations")
    .select(COLS)
    .eq("ticket_type", type)
    .eq("ticket_id", ticketId)
    .order("requested_at", { ascending: true });
  return (data ?? []).map((r) => toExplanation(r as Record<string, unknown>));
}

export async function explanationsForStaff(staffId: string) {
  const { data } = await supabaseAdmin
    .from("ticket_explanations")
    .select(COLS)
    .eq("staff_id", staffId)
    .order("requested_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((r) => toExplanation(r as Record<string, unknown>));
}

export async function pendingExplanationCount(staffId: string) {
  const { count } = await supabaseAdmin
    .from("ticket_explanations")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staffId)
    .is("explained_at", null);
  return count ?? 0;
}
