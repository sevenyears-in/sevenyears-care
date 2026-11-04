// Marking alerts read when the person opens what the alert is about (server only).

import { supabaseAdmin } from "@/lib/supabase/server";

/** Alerts about this ticket, or whose title matches, are marked read for this person. */
export async function markAlertsRead(staffId: string, match: { ticketId?: string; titleLike?: string }) {
  try {
    let query = supabaseAdmin
      .from("staff_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .is("read_at", null);
    if (match.ticketId) query = query.eq("ticket_id", match.ticketId);
    if (match.titleLike) query = query.ilike("title", match.titleLike);
    if (!match.ticketId && !match.titleLike) return;
    await query;
  } catch (error) {
    console.error("Mark alerts read failed:", error);
  }
}
