// Service requests and complaints for the staff side: who can see them,
// loading lists and details, and the workflow actions (server only).

import { supabaseAdmin } from "@/lib/supabase/server";
import type { StaffUser } from "@/lib/auth";
import { asRole, isAdmin, type Role, sameStore } from "@/lib/roles";
import {
  ACK_HOURS,
  activeStatuses,
  addHours,
  COMPLAINT_RESOLUTIONS,
  COMPLAINT_SEVERITIES,
  PRIORITIES,
  resolutionHours,
  SERVICE_RESOLUTIONS,
  SERVICE_SEVERITIES,
  slaState,
  type TicketType,
} from "@/lib/sla";
import { findRecipients, findStaffByIds, notifyCustomer, notifyStaff, type StaffAlert } from "@/lib/notify";

// ------------------------------------------------------------------
// Shapes
// ------------------------------------------------------------------

export type Ticket = {
  type: TicketType;
  id: string;
  number: string;
  status: string;
  priority: string;
  severity: string | null;
  title: string; // issue type (service) or category (complaint)
  description: string;
  storeName: string | null;
  contactName: string | null;
  contactMobile: string | null;
  contactEmail: string | null;
  productName: string | null;
  assigneeId: string | null; // technician (service) or owner (complaint)
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  ackDueAt: string | null;
  resolutionDueAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionType: string | null;
  customerNote: string | null;
  escalationLevel: number;
  // service only
  serviceMode?: string | null;
  preferredDate?: string | null;
  address?: string | null;
  underWarranty?: boolean | null;
  warrantyNumber?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // complaint only
  referenceNumber?: string | null;
};

const TABLE: Record<TicketType, string> = { service: "service_requests", complaint: "complaints" };
const NUMBER_COL: Record<TicketType, string> = { service: "request_number", complaint: "complaint_number" };
const ASSIGNEE_COL: Record<TicketType, string> = { service: "assigned_technician_id", complaint: "owner_id" };

const COMMON_COLS =
  "id, status, priority, severity, store_name, contact_name, contact_mobile, description, created_at, updated_at, acknowledged_at, ack_due_at, resolution_due_at, resolved_at, closed_at, resolution_type, resolution_notes, escalation_level";

const SELECT: Record<TicketType, string> = {
  service: `${COMMON_COLS}, request_number, issue_type, product_name, assigned_technician_id, service_mode, preferred_date, address, under_warranty, latitude, longitude, warranties ( warranty_number )`,
  complaint: `${COMMON_COLS}, complaint_number, category, contact_email, reference_number, owner_id`,
};

type Row = Record<string, unknown>;

function str(v: unknown) {
  return v === null || v === undefined ? null : String(v);
}

function toTicket(type: TicketType, row: Row, names: Map<string, string>): Ticket {
  const assigneeId = str(row[ASSIGNEE_COL[type]]);
  const warranty = row.warranties as { warranty_number?: string } | { warranty_number?: string }[] | null;
  const warrantyNumber = Array.isArray(warranty) ? warranty[0]?.warranty_number : warranty?.warranty_number;

  return {
    type,
    id: String(row.id),
    number: String(row[NUMBER_COL[type]]),
    status: String(row.status),
    priority: str(row.priority) ?? "normal",
    severity: str(row.severity),
    title: String(type === "service" ? row.issue_type : row.category),
    description: String(row.description ?? ""),
    storeName: str(row.store_name),
    contactName: str(row.contact_name),
    contactMobile: str(row.contact_mobile),
    contactEmail: str(row.contact_email),
    productName: str(row.product_name),
    assigneeId,
    assigneeName: assigneeId ? names.get(assigneeId) ?? null : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    acknowledgedAt: str(row.acknowledged_at),
    ackDueAt: str(row.ack_due_at),
    resolutionDueAt: str(row.resolution_due_at),
    resolvedAt: str(row.resolved_at),
    closedAt: str(row.closed_at),
    resolutionType: str(row.resolution_type),
    customerNote: str(row.resolution_notes),
    escalationLevel: Number(row.escalation_level ?? 0),
    serviceMode: str(row.service_mode),
    preferredDate: str(row.preferred_date),
    address: str(row.address),
    underWarranty: typeof row.under_warranty === "boolean" ? row.under_warranty : null,
    warrantyNumber: warrantyNumber ?? null,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    referenceNumber: str(row.reference_number),
  };
}

async function staffNames(ids: (string | null)[]) {
  const clean = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (clean.length === 0) return names;
  const { data } = await supabaseAdmin.from("staff_users").select("id, full_name").in("id", clean);
  for (const s of data ?? []) names.set(String(s.id), String(s.full_name));
  return names;
}

// ------------------------------------------------------------------
// Who can see what
// ------------------------------------------------------------------

export function canViewTicket(staff: StaffUser, type: TicketType, t: { storeName: string | null; assigneeId: string | null }) {
  if (isAdmin(staff.role)) return true;
  if (type === "service") {
    if (staff.role === "service_head") return true;
    if (staff.role === "store_manager") return sameStore(staff.storeName, t.storeName);
    if (staff.role === "technician") return t.assigneeId === staff.id || sameStore(staff.storeName, t.storeName);
    return false;
  }
  if (staff.role === "hr_head" || staff.role === "operations_manager") return true;
  if (staff.role === "store_manager") return sameStore(staff.storeName, t.storeName);
  return false;
}

/** Can triage, assign, close and reopen (not just work on assigned jobs). */
export function isTicketManager(staff: StaffUser, type: TicketType) {
  const managers: Role[] =
    type === "service"
      ? ["super_admin", "admin", "service_head", "store_manager"]
      : ["super_admin", "admin", "hr_head", "operations_manager", "store_manager"];
  return managers.includes(staff.role);
}

function quote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type ListFilter = "action" | "new" | "overdue" | "mine" | "active" | "closed" | "all";

export async function listTickets(
  staff: StaffUser,
  type: TicketType,
  filter: ListFilter = "action",
  search = ""
): Promise<Ticket[]> {
  let query = supabaseAdmin.from(TABLE[type]).select(SELECT[type]).order("created_at", { ascending: false }).limit(300);

  // Scope to what this person may see.
  if (!isAdmin(staff.role)) {
    const store = staff.storeName?.trim() ?? "";
    if (type === "service" && staff.role === "technician") {
      query = store
        ? query.or(`store_name.ilike.${quote(escapeLike(store))},assigned_technician_id.eq.${staff.id}`)
        : query.eq("assigned_technician_id", staff.id);
    } else if (staff.role === "store_manager") {
      if (!store) return [];
      query = query.ilike("store_name", escapeLike(store));
    } else if (
      !(type === "service" && staff.role === "service_head") &&
      !(type === "complaint" && (staff.role === "hr_head" || staff.role === "operations_manager"))
    ) {
      return [];
    }
  }

  const active = activeStatuses(type);
  if (filter === "closed") query = query.in("status", ["resolved", "closed", "cancelled"]);
  else if (filter !== "all") query = query.in("status", active);
  if (filter === "new") query = query.eq("status", "open");
  if (filter === "mine") query = query.eq(ASSIGNEE_COL[type], staff.id);

  const term = search.trim();
  if (term) {
    const like = `%${escapeLike(term)}%`;
    query = query.or(
      [
        `${NUMBER_COL[type]}.ilike.${quote(like)}`,
        `contact_mobile.ilike.${quote(like)}`,
        `contact_name.ilike.${quote(like)}`,
      ].join(",")
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error(`List ${type} error:`, error);
    return [];
  }

  const rows = (data ?? []) as unknown as Row[];
  const names = await staffNames(rows.map((r) => str(r[ASSIGNEE_COL[type]])));
  let tickets = rows.map((r) => toTicket(type, r, names));

  if (filter === "overdue") tickets = tickets.filter((t) => slaState(rawSla(t)).state === "overdue");
  if (filter === "action") tickets = tickets.filter((t) => needsActionFrom(staff, t));

  return sortByUrgency(tickets);
}

export function rawSla(t: Ticket) {
  return {
    status: t.status,
    acknowledged_at: t.acknowledgedAt,
    ack_due_at: t.ackDueAt,
    resolution_due_at: t.resolutionDueAt,
  };
}

/** Does this ticket wait on this person right now? */
export function needsActionFrom(staff: StaffUser, t: Ticket) {
  if (!activeStatuses(t.type).includes(t.status)) return false;
  if (t.status === "open") return true; // everyone who can see it should acknowledge
  if (t.assigneeId === staff.id) return true;
  if (!t.assigneeId && isTicketManager(staff, t.type)) return true; // still needs an owner
  if (t.status === "awaiting_approval" && ["service_head", "super_admin"].includes(staff.role)) return true;
  if (slaState(rawSla(t)).state === "overdue" && isTicketManager(staff, t.type)) return true;
  return false;
}

const PRIORITY_RANK: Record<string, number> = { safety: 0, high: 1, normal: 2 };

export function sortByUrgency(tickets: Ticket[]) {
  return [...tickets].sort((a, b) => {
    const sa = slaState(rawSla(a)).state === "overdue" ? 0 : 1;
    const sb = slaState(rawSla(b)).state === "overdue" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const pa = PRIORITY_RANK[a.priority] ?? 2;
    const pb = PRIORITY_RANK[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = new Date(a.ackDueAt && !a.acknowledgedAt ? a.ackDueAt : a.resolutionDueAt ?? a.createdAt).getTime();
    const db = new Date(b.ackDueAt && !b.acknowledgedAt ? b.ackDueAt : b.resolutionDueAt ?? b.createdAt).getTime();
    return da - db;
  });
}

export async function getTicket(type: TicketType, id: string): Promise<Ticket | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabaseAdmin.from(TABLE[type]).select(SELECT[type]).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Row;
  const names = await staffNames([str(row[ASSIGNEE_COL[type]])]);
  return toTicket(type, row, names);
}

export type HistoryEntry = {
  status: string;
  note: string | null;
  action: string | null;
  actorName: string | null;
  visibility: "customer" | "internal";
  createdAt: string;
};

export async function getHistory(type: TicketType, id: string): Promise<HistoryEntry[]> {
  const { data } = await supabaseAdmin
    .from("ticket_status_history")
    .select("status, note, action, actor_name, visibility, created_at")
    .eq("ticket_type", type)
    .eq("ticket_id", id)
    .order("created_at", { ascending: true });

  return (data ?? []).map((h) => ({
    status: String(h.status),
    note: str(h.note),
    action: str(h.action),
    actorName: str(h.actor_name),
    visibility: h.visibility === "internal" ? "internal" : "customer",
    createdAt: String(h.created_at),
  }));
}

/** People who can be given the job: technicians (service) or complaint owners. */
export async function assignableStaff(type: TicketType, storeName: string | null) {
  const roles: Role[] =
    type === "service"
      ? ["technician", "service_head"]
      : ["store_manager", "hr_head", "operations_manager", "super_admin"];

  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("id, full_name, role, store_name")
    .eq("is_active", true)
    .in("role", roles)
    .order("full_name");

  return (data ?? [])
    .map((s) => ({
      id: String(s.id),
      fullName: String(s.full_name),
      role: asRole(s.role),
      storeName: str(s.store_name),
      sameStore: sameStore(str(s.store_name), storeName),
    }))
    .sort((a, b) => Number(b.sameStore) - Number(a.sameStore));
}

// ------------------------------------------------------------------
// New ticket: deadlines + alerts (called by the public APIs)
// ------------------------------------------------------------------

export function initialDeadlines(type: TicketType, priority: string, createdAt = new Date()) {
  return {
    ack_due_at: addHours(createdAt, ACK_HOURS),
    resolution_due_at: addHours(createdAt, resolutionHours(type, null, priority)),
  };
}

export async function announceNewTicket(input: {
  type: TicketType;
  id: string;
  number: string;
  storeName: string | null;
  title: string;
  summary: string;
  details: string[];
  priority: string;
  customer: { name: string | null; mobile: string | null; email?: string | null };
}) {
  const recipients = await findRecipients(
    input.type === "service" ? ["store_manager", "technician", "service_head"] : ["store_manager", "hr_head", "operations_manager"],
    input.storeName
  );

  const headline =
    input.priority === "safety"
      ? `SAFETY ${input.type === "service" ? "service request" : "complaint"}`
      : `New ${input.type === "service" ? "service request" : "complaint"}`;

  await notifyStaff(recipients, {
    ticketType: input.type,
    ticketId: input.id,
    ticketNumber: input.number,
    title: headline,
    summary: input.summary,
    details: [...input.details, `Please acknowledge within ${ACK_HOURS} hours.`],
    storeName: input.storeName,
  });

  await notifyCustomer({
    name: input.customer.name,
    mobile: input.customer.mobile,
    email: input.customer.email,
    ticketNumber: input.number,
    message:
      input.type === "service"
        ? `We have received your service request. Our team will contact you within ${ACK_HOURS} working hours.`
        : `We have received your complaint and we are sorry for the trouble. Our team will contact you within ${ACK_HOURS} working hours.`,
  });
}

// ------------------------------------------------------------------
// Workflow actions
// ------------------------------------------------------------------

export type ActionName =
  | "acknowledge"
  | "triage"
  | "assign"
  | "start"
  | "awaiting_parts"
  | "request_approval"
  | "approve"
  | "reject"
  | "resolve"
  | "close"
  | "reopen"
  | "cancel"
  | "note";

export type ActionInput = {
  action: ActionName;
  note?: string;
  customerNote?: string;
  severity?: string;
  priority?: string;
  assigneeId?: string;
  resolutionType?: string;
  visibility?: "customer" | "internal";
};

type Plan = {
  update: Record<string, unknown>;
  status: string;
  history: { note: string | null; visibility: "customer" | "internal" }[];
  customerMessage?: string;
  staffAlert?: { ids?: string[]; roles?: Role[]; title: string; summary: string };
};

export type ActionResult = { ok: true } | { ok: false; error: string; status?: number };

/** Which actions this person can take on this ticket right now. */
export function availableActions(staff: StaffUser, t: Ticket): ActionName[] {
  if (!canViewTicket(staff, t.type, t)) return [];
  const manager = isTicketManager(staff, t.type);
  const assignee = t.assigneeId === staff.id;
  const worker = manager || assignee;
  const s = t.status;
  const list: ActionName[] = [];

  if (s === "open") list.push("acknowledge");

  if (t.type === "service") {
    const active = activeStatuses("service").includes(s);
    if (active && manager) list.push("triage", "assign");
    if (["acknowledged", "assigned", "awaiting_parts"].includes(s) && worker) list.push("start");
    if (["assigned", "in_progress"].includes(s) && worker) list.push("awaiting_parts");
    if (["assigned", "in_progress", "awaiting_parts"].includes(s) && worker) list.push("request_approval");
    if (s === "awaiting_approval" && ["service_head", "super_admin", "admin"].includes(staff.role)) list.push("approve", "reject");
    if (["acknowledged", "assigned", "in_progress", "awaiting_parts"].includes(s) && worker) list.push("resolve");
    if (s === "resolved" && manager) list.push("close");
    if (["resolved", "closed"].includes(s) && manager) list.push("reopen");
    if (active && ["service_head", "super_admin", "admin"].includes(staff.role)) list.push("cancel");
  } else {
    const active = activeStatuses("complaint").includes(s);
    if (active && manager) list.push("triage", "assign");
    if (["acknowledged", "under_review"].includes(s) && worker) list.push("start");
    if (["acknowledged", "under_review", "in_progress"].includes(s) && worker) list.push("resolve");
    if (s === "resolved" && manager) list.push("close");
    if (["resolved", "closed"].includes(s) && manager) list.push("reopen");
  }

  list.push("note");
  return list;
}

function fail(error: string, status = 400): ActionResult {
  return { ok: false, error, status };
}

function planAction(staff: StaffUser, t: Ticket, input: ActionInput, assigneeName: string | null): Plan | string {
  const now = new Date().toISOString();
  const note = input.note?.trim() || "";
  const customerNote = input.customerNote?.trim() || "";
  const ackFields = t.acknowledgedAt ? {} : { acknowledged_at: now, acknowledged_by: staff.id };
  const kind = t.type === "service" ? "service request" : "complaint";

  switch (input.action) {
    case "acknowledge":
      return {
        update: { ...ackFields, status: "acknowledged" },
        status: "acknowledged",
        history: [{ note: "Our team has acknowledged your request.", visibility: "customer" }],
        customerMessage: `Our team has received your ${kind} and is working on it.`,
      };

    case "triage": {
      const severities = (t.type === "service" ? SERVICE_SEVERITIES : COMPLAINT_SEVERITIES).map((s) => s.value);
      const severity = input.severity || t.severity;
      const priority = input.priority || t.priority;
      if (severity && !severities.includes(severity)) return "Choose a valid classification.";
      if (!PRIORITIES.some((p) => p.value === priority)) return "Choose a valid priority.";
      const due = addHours(t.createdAt, resolutionHours(t.type, severity, priority));
      return {
        update: { severity, priority, resolution_due_at: due },
        status: t.status,
        history: [
          {
            note: `Classified as ${severity ?? "unclassified"}, priority ${priority}. Resolve by ${new Date(due).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.${note ? ` ${note}` : ""}`,
            visibility: "internal",
          },
        ],
      };
    }

    case "assign": {
      if (!input.assigneeId) return "Choose who will handle it.";
      const newStatus =
        t.type === "service"
          ? ["open", "acknowledged"].includes(t.status) ? "assigned" : t.status
          : ["open", "acknowledged"].includes(t.status) ? "under_review" : t.status;
      return {
        update: { ...ackFields, [ASSIGNEE_COL[t.type]]: input.assigneeId, status: newStatus },
        status: newStatus,
        history: [
          { note: `Assigned to ${assigneeName ?? "staff"}.${note ? ` ${note}` : ""}`, visibility: "internal" },
          ...(newStatus !== t.status
            ? [
                {
                  note:
                    t.type === "service"
                      ? "A technician has been assigned to your request."
                      : "Your complaint is being reviewed by our team.",
                  visibility: "customer" as const,
                },
              ]
            : []),
        ],
        customerMessage:
          newStatus !== t.status
            ? t.type === "service"
              ? "A technician has been assigned to your request. We will contact you shortly."
              : "Your complaint has been assigned to our team for review."
            : undefined,
        staffAlert: {
          ids: [input.assigneeId],
          title: "Assigned to you",
          summary: `${t.title} — ${t.productName ?? t.contactName ?? ""}`.trim(),
        },
      };
    }

    case "start":
      return {
        update: { ...ackFields, status: "in_progress" },
        status: "in_progress",
        history: [{ note: customerNote || "Work has started on your request.", visibility: "customer" }],
        customerMessage: customerNote || undefined,
      };

    case "awaiting_parts":
      if (!customerNote) return "Tell the customer which part is awaited and the expected date.";
      return {
        update: { status: "awaiting_parts", resolution_notes: customerNote },
        status: "awaiting_parts",
        history: [{ note: customerNote, visibility: "customer" }],
        customerMessage: customerNote,
      };

    case "request_approval":
      if (!note) return "Explain why a replacement is needed (defect, warranty check).";
      return {
        update: { status: "awaiting_approval" },
        status: "awaiting_approval",
        history: [
          { note: `Replacement approval requested: ${note}`, visibility: "internal" },
          { note: "Your product is being checked for replacement.", visibility: "customer" },
        ],
        staffAlert: {
          roles: ["service_head", "super_admin"],
          title: "Replacement approval needed",
          summary: `${t.title} — ${note}`,
        },
      };

    case "approve":
      return {
        update: { status: "in_progress", resolution_notes: customerNote || "Your replacement has been approved." },
        status: "in_progress",
        history: [
          { note: `Replacement approved.${note ? ` ${note}` : ""}`, visibility: "internal" },
          { note: customerNote || "Your replacement has been approved.", visibility: "customer" },
        ],
        customerMessage: customerNote || "Good news — your replacement has been approved. We will contact you to arrange it.",
        staffAlert: t.assigneeId
          ? { ids: [t.assigneeId], title: "Replacement approved", summary: `${t.title}${note ? ` — ${note}` : ""}` }
          : undefined,
      };

    case "reject":
      if (!note) return "Give the reason for not approving the replacement.";
      return {
        update: { status: "in_progress" },
        status: "in_progress",
        history: [{ note: `Replacement not approved: ${note}`, visibility: "internal" }],
        staffAlert: t.assigneeId
          ? { ids: [t.assigneeId], title: "Replacement not approved", summary: note }
          : undefined,
      };

    case "resolve": {
      const types = (t.type === "service" ? SERVICE_RESOLUTIONS : COMPLAINT_RESOLUTIONS).map((r) => r.value);
      if (!input.resolutionType || !types.includes(input.resolutionType)) return "Choose how it was resolved.";
      if (!customerNote) return "Write the message the customer will see (what was done).";
      return {
        update: {
          ...ackFields,
          status: "resolved",
          resolved_at: now,
          resolution_type: input.resolutionType,
          resolution_notes: customerNote,
        },
        status: "resolved",
        history: [
          { note: customerNote, visibility: "customer" },
          ...(note ? [{ note, visibility: "internal" as const }] : []),
        ],
        customerMessage: `${customerNote} If anything is still not right, please reply or call us and we will reopen it.`,
      };
    }

    case "close":
      return {
        update: { status: "closed", closed_at: now },
        status: "closed",
        history: [
          { note: "Closed after customer confirmation. Thank you for choosing Seven Years.", visibility: "customer" },
          ...(note ? [{ note, visibility: "internal" as const }] : []),
        ],
        customerMessage: "Your request is now closed. Thank you for choosing Seven Years!",
      };

    case "reopen":
      if (!note) return "Give the reason for reopening.";
      return {
        update: { status: "in_progress", resolved_at: null, closed_at: null },
        status: "in_progress",
        history: [
          { note: `Reopened: ${note}`, visibility: "internal" },
          { note: "Your request has been reopened and we are working on it again.", visibility: "customer" },
        ],
        customerMessage: "Your request has been reopened and we are working on it again.",
        staffAlert: t.assigneeId ? { ids: [t.assigneeId], title: "Request reopened", summary: note } : undefined,
      };

    case "cancel":
      if (!customerNote) return "Write the reason the customer will see.";
      return {
        update: { status: "cancelled", closed_at: now, resolution_notes: customerNote },
        status: "cancelled",
        history: [{ note: customerNote, visibility: "customer" }],
        customerMessage: customerNote,
      };

    case "note": {
      const visibility = input.visibility === "customer" ? "customer" : "internal";
      const text = visibility === "customer" ? customerNote || note : note;
      if (!text) return "Write the note.";
      return {
        update: visibility === "customer" ? { resolution_notes: text } : {},
        status: t.status,
        history: [{ note: text, visibility }],
        customerMessage: visibility === "customer" ? text : undefined,
      };
    }
  }
}

export async function runAction(
  staff: StaffUser,
  type: TicketType,
  id: string,
  input: ActionInput
): Promise<ActionResult & { followUp?: () => Promise<void> }> {
  const ticket = await getTicket(type, id);
  if (!ticket || !canViewTicket(staff, type, ticket)) return fail("Request not found.", 404);

  if (!availableActions(staff, ticket).includes(input.action)) {
    return fail("This action isn't available for this request right now. Refresh the page.", 409);
  }

  // Validate the person being assigned.
  let assigneeName: string | null = null;
  if (input.action === "assign") {
    const options = await assignableStaff(type, ticket.storeName);
    const chosen = options.find((o) => o.id === input.assigneeId);
    if (!chosen) return fail("Choose a valid person to assign.");
    if (staff.role === "store_manager" && type === "service" && chosen.role === "technician" && !chosen.sameStore) {
      return fail("Store managers can assign technicians of their own store. Ask the Service Head for others.");
    }
    assigneeName = chosen.fullName;
  }

  const plan = planAction(staff, ticket, input, assigneeName);
  if (typeof plan === "string") return fail(plan);

  if (Object.keys(plan.update).length > 0) {
    // Only update if the status hasn't changed since the page was loaded.
    const { data: updated, error } = await supabaseAdmin
      .from(TABLE[type])
      .update(plan.update)
      .eq("id", id)
      .eq("status", ticket.status)
      .select("id");
    if (error) {
      console.error("Ticket update error:", error);
      return fail("Unable to save. Please try again.", 500);
    }
    if (!updated || updated.length === 0) {
      return fail("Someone else just updated this request. Refresh the page and try again.", 409);
    }
  }

  const { error: historyError } = await supabaseAdmin.from("ticket_status_history").insert(
    plan.history.map((h) => ({
      ticket_type: type,
      ticket_id: id,
      status: plan.status,
      note: h.note,
      visibility: h.visibility,
      action: input.action,
      actor_id: staff.id,
      actor_name: staff.fullName,
    }))
  );
  if (historyError) console.error("History insert error:", historyError);

  const followUp = async () => {
    if (plan.customerMessage) {
      await notifyCustomer({
        name: ticket.contactName,
        mobile: ticket.contactMobile,
        email: ticket.contactEmail,
        ticketNumber: ticket.number,
        message: plan.customerMessage,
      });
    }
    if (plan.staffAlert) {
      const people = [
        ...(plan.staffAlert.ids ? await findStaffByIds(plan.staffAlert.ids) : []),
        ...(plan.staffAlert.roles ? await findRecipients(plan.staffAlert.roles, ticket.storeName) : []),
      ];
      const alert: StaffAlert = {
        ticketType: type,
        ticketId: id,
        ticketNumber: ticket.number,
        title: plan.staffAlert.title,
        summary: plan.staffAlert.summary,
        details: [`By ${staff.fullName}`],
        storeName: ticket.storeName,
      };
      await notifyStaff(people, alert, staff.id);
    }
  };

  return { ok: true, followUp };
}
