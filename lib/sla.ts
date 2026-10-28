// Service levels (from the Seven Years SOPs: Toys Service SOP §16.7 and
// Customer Complaint Management §17.6). Change the numbers here only.
// Shared by server and client code.

export type TicketType = "service" | "complaint";

/** Acknowledge every new request within this many hours. */
export const ACK_HOURS = 2;

/** Resolution time (hours from when the request was raised). */
export const SERVICE_TAT_HOURS: Record<string, number> = {
  installation: 24, // same day / next day
  minor: 48, // quick fix — max 2 days
  moderate: 72, // repair — max 3 days
  major: 168, // replacement — max 7 days
  unclassified: 72,
};

export const COMPLAINT_TAT_HOURS: Record<string, number> = {
  minor: 48,
  moderate: 72,
  major: 168,
  unclassified: 72,
};

/** Safety issues on baby gear (brakes, frames, locks) get top priority and 24 h. */
export const SAFETY_TAT_HOURS = 24;

export const SERVICE_SEVERITIES = [
  { value: "minor", label: "Minor — quick fix (2 days)" },
  { value: "moderate", label: "Moderate — repair / part (3 days)" },
  { value: "major", label: "Major — replacement / DOA (7 days)" },
  { value: "installation", label: "Installation / assembly (1 day)" },
];

export const COMPLAINT_SEVERITIES = [
  { value: "minor", label: "Minor (2 days)" },
  { value: "moderate", label: "Moderate (3 days)" },
  { value: "major", label: "Major (7 days)" },
];

export const PRIORITIES = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "safety", label: "Safety — stop using the product" },
];

export const SERVICE_RESOLUTIONS = [
  { value: "repaired", label: "Repaired" },
  { value: "part_replaced", label: "Part replaced" },
  { value: "product_replaced", label: "Product replaced" },
  { value: "installed", label: "Installed / assembled" },
  { value: "no_fault_found", label: "No fault found / usage explained" },
  { value: "chargeable_repair", label: "Chargeable repair (out of warranty)" },
  { value: "other", label: "Other" },
];

export const COMPLAINT_RESOLUTIONS = [
  { value: "apology_explanation", label: "Apology / explanation given" },
  { value: "refund", label: "Refund" },
  { value: "replacement", label: "Replacement" },
  { value: "billing_corrected", label: "Billing corrected" },
  { value: "staff_counselled", label: "Staff counselled / corrective action" },
  { value: "delivery_fixed", label: "Delivery / installation fixed" },
  { value: "other", label: "Other" },
];

/** Issue types that are treated as safety-related automatically. */
export const SAFETY_ISSUE_TYPES = ["Wheel, brake or frame issue"];

export function resolutionHours(type: TicketType, severity: string | null, priority: string) {
  if (priority === "safety") return SAFETY_TAT_HOURS;
  const table = type === "service" ? SERVICE_TAT_HOURS : COMPLAINT_TAT_HOURS;
  return table[severity ?? "unclassified"] ?? table.unclassified;
}

export function addHours(fromIso: string | Date, hours: number) {
  const from = typeof fromIso === "string" ? new Date(fromIso) : fromIso;
  return new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export const ACTIVE_SERVICE_STATUSES = [
  "open",
  "acknowledged",
  "assigned",
  "in_progress",
  "awaiting_parts",
  "awaiting_approval",
];

export const ACTIVE_COMPLAINT_STATUSES = ["open", "acknowledged", "under_review", "in_progress"];

export function activeStatuses(type: TicketType) {
  return type === "service" ? ACTIVE_SERVICE_STATUSES : ACTIVE_COMPLAINT_STATUSES;
}

export type SlaState = "ok" | "due_soon" | "overdue" | "done";

/** Where a ticket stands against its deadlines. */
export function slaState(ticket: {
  status: string;
  acknowledged_at: string | null;
  ack_due_at: string | null;
  resolution_due_at: string | null;
}, now = Date.now()): { state: SlaState; label: string; due: string | null } {
  if (["resolved", "closed", "cancelled"].includes(ticket.status)) {
    return { state: "done", label: "Done", due: null };
  }

  if (!ticket.acknowledged_at && ticket.status === "open" && ticket.ack_due_at) {
    const due = new Date(ticket.ack_due_at).getTime();
    if (now > due) return { state: "overdue", label: "Not acknowledged — overdue", due: ticket.ack_due_at };
    return { state: due - now < 30 * 60 * 1000 ? "due_soon" : "ok", label: "Acknowledge by", due: ticket.ack_due_at };
  }

  if (ticket.resolution_due_at) {
    const due = new Date(ticket.resolution_due_at).getTime();
    if (now > due) return { state: "overdue", label: "Resolution overdue", due: ticket.resolution_due_at };
    return { state: due - now < 6 * 60 * 60 * 1000 ? "due_soon" : "ok", label: "Resolve by", due: ticket.resolution_due_at };
  }

  return { state: "ok", label: "", due: null };
}

/** Friendly status names shown to customers. */
export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  open: "Received",
  acknowledged: "Acknowledged",
  assigned: "Technician Assigned",
  under_review: "Under Review",
  in_progress: "In Progress",
  awaiting_parts: "Waiting for Parts",
  awaiting_approval: "Replacement Approval",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled",
};
