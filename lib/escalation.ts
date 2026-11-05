import { purgeServicePhotos } from "@/lib/service-photos";
// Automatic escalation (SOP escalation matrix), run by /api/cron/sla.
//
// Level 1 — not acknowledged in time, or resolution time missed:
//           Store Manager (+ Service Head for service requests)
// Level 2 — still not resolved 24 hours after the deadline:
//           Operations Manager (+ Service Head for service requests)
// Level 3 — still not resolved 48 hours after the deadline:
//           Super Admin (senior management)
// The Directors of the store are told at every level.

import { supabaseAdmin } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";
import { activeStatuses, complaintKind, type TicketType } from "@/lib/sla";
import { findDirectors, findRecipients, notifyStaff } from "@/lib/notify";

const LEVEL_ROLES: Record<TicketType, Record<number, Role[]>> = {
  service: {
    1: ["store_manager", "service_head"],
    2: ["operations_manager", "service_head"],
    3: ["super_admin"],
  },
  // Complaints: 1 = not acknowledged in time, 2 = deadline missed, 3 = still open 24 h after the deadline.
  complaint: {
    1: ["store_manager"],
    2: ["store_manager"],
    3: ["super_admin"],
  },
};

const HOUR = 60 * 60 * 1000;

export async function runEscalations() {
  const summary = { checked: 0, escalated: 0, autoClosed: 0 };

  for (const type of ["service", "complaint"] as TicketType[]) {
    const table = type === "service" ? "service_requests" : "complaints";
    const numberCol = type === "service" ? "request_number" : "complaint_number";
    const titleCol = type === "service" ? "issue_type" : "category";

    const { data, error } = await supabaseAdmin
      .from(table)
      .select(`id, ${numberCol}, ${titleCol}, status, store_name, contact_name, acknowledged_at, ack_due_at, resolution_due_at, escalation_level`)
      .in("status", activeStatuses(type))
      .limit(1000);

    if (error) {
      console.error(`Escalation query (${type}) failed:`, error);
      continue;
    }

    const now = Date.now();

    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      summary.checked++;
      const current = Number(row.escalation_level ?? 0);
      const ackLate =
        row.status === "open" && !row.acknowledged_at && row.ack_due_at && now > new Date(String(row.ack_due_at)).getTime();
      const due = row.resolution_due_at ? new Date(String(row.resolution_due_at)).getTime() : null;
      const lateBy = due ? now - due : -1;

      let level = 0;
      if (type === "complaint") {
        if (ackLate) level = 1;
        if (lateBy > 0) level = 2;
        if (lateBy > 24 * HOUR) level = 3;
      } else {
        if (ackLate || lateBy > 0) level = 1;
        if (lateBy > 24 * HOUR) level = 2;
        if (lateBy > 48 * HOUR) level = 3;
      }
      if (level <= current) continue;

      const reason = lateBy > 0 ? "Resolution time missed" : "Not acknowledged within 2 hours";
      const { data: updated } = await supabaseAdmin
        .from(table)
        .update({ escalation_level: level, last_escalated_at: new Date().toISOString() })
        .eq("id", String(row.id))
        .eq("escalation_level", current)
        .select("id");
      if (!updated?.length) continue;

      await supabaseAdmin.from("ticket_status_history").insert({
        ticket_type: type,
        ticket_id: String(row.id),
        status: String(row.status),
        note: `Escalated to level ${level}: ${reason}.`,
        action: "escalate",
        actor_name: "System",
        visibility: "internal",
      });

      const storeName = (row.store_name as string | null) ?? null;
      // Every SOP violation also goes to the Directors of that store.
      const staffComplaint = type === "complaint" && complaintKind(String(row[titleCol] ?? "")) === "staff";
      const roles: Role[] = [...LEVEL_ROLES[type][level], ...(staffComplaint && level >= 2 ? (["hr_head"] as Role[]) : [])];
      const recipients = [...(await findRecipients(roles, storeName)), ...(await findDirectors(storeName))];
      await notifyStaff(recipients, {
        ticketType: type,
        ticketId: String(row.id),
        ticketNumber: String(row[numberCol]),
        title: `ESCALATION L${level}`,
        summary: `${reason} — ${String(row[titleCol])} (${String(row.contact_name ?? "customer")})`,
        details: [`Current status: ${String(row.status).replace(/_/g, " ")}`],
        storeName,
      });
      summary.escalated++;
    }
  }

  // Resolved complaints the customer didn't answer within 3 days are closed automatically.
  const cutoff = new Date(Date.now() - 3 * 24 * HOUR).toISOString();
  const { data: stale } = await supabaseAdmin
    .from("complaints")
    .select("id")
    .eq("status", "resolved")
    .lt("resolved_at", cutoff)
    .limit(500);
  for (const row of stale ?? []) {
    const { data: closed } = await supabaseAdmin
      .from("complaints")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "resolved")
      .select("id");
    if (!closed?.length) continue;
    await supabaseAdmin.from("ticket_status_history").insert({
      ticket_type: "complaint",
      ticket_id: row.id,
      status: "closed",
      note: "Closed automatically — no reply from the customer within 3 days of the resolution.",
      action: "auto_close",
      actor_name: "System",
      visibility: "customer",
    });
    summary.autoClosed++;
  }

  // Photos of closed service requests, and uploads never sent, are deleted for good.
  const photosDeleted = await purgeServicePhotos().catch((error) => {
    console.error("Photo clean-up failed:", error);
    return 0;
  });

  return { ...summary, photosDeleted };
}
