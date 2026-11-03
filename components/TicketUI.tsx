// Shared pieces for the staff Service Requests and Complaints screens.

import Link from "next/link";
import { StatusBadge } from "@/components/SiteChrome";
import { formatDateTime, statusLabel } from "@/lib/helpers";
import { slaState } from "@/lib/sla";
import type { ListFilter, Ticket } from "@/lib/tickets";

export function SlaBadge({ ticket }: { ticket: Ticket }) {
  const sla = slaState({
    status: ticket.status,
    acknowledged_at: ticket.acknowledgedAt,
    ack_due_at: ticket.ackDueAt,
    resolution_due_at: ticket.resolutionDueAt,
  });
  if (sla.state === "done") return null;

  const colour =
    sla.state === "overdue"
      ? "bg-red-100 text-red-800"
      : sla.state === "due_soon"
        ? "bg-amber-100 text-amber-800"
        : "bg-black/[0.04] text-black/55";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${colour}`}>
      {sla.state === "overdue" ? "⏰ " : ""}
      {sla.label}
      {sla.due && sla.state !== "overdue" ? ` ${formatDateTime(sla.due)}` : ""}
    </span>
  );
}

export function PriorityBadge({
  priority,
  type = "service",
  severity = null,
}: {
  priority: string;
  type?: "service" | "complaint";
  severity?: string | null;
}) {
  if (type === "complaint") {
    // Complaints show their severity (Critical 24 h / High 48 h), never "safety".
    if (severity === "critical")
      return <span className="inline-flex rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm shadow-red-600/30">Critical · 24 h</span>;
    if (severity === "high")
      return <span className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 ring-1 ring-inset ring-orange-600/20">High · 48 h</span>;
    return null;
  }
  if (priority === "safety")
    return <span className="inline-flex rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm shadow-red-600/30">⚠ SAFETY</span>;
  if (priority === "high")
    return <span className="inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 ring-1 ring-inset ring-orange-600/20">High</span>;
  return null;
}

export function EscalationBadge({ level }: { level: number }) {
  if (!level) return null;
  return (
    <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-600/20">
      Escalated L{level}
    </span>
  );
}

const FILTER_LABELS: Record<ListFilter, string> = {
  action: "Needs my action",
  new: "New",
  overdue: "Overdue",
  mine: "Assigned to me",
  active: "All open",
  closed: "Resolved / closed",
  all: "Everything",
};

export function FilterTabs({
  base,
  current,
  search,
  store = "",
}: {
  base: string;
  current: ListFilter;
  search: string;
  store?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(FILTER_LABELS) as ListFilter[]).map((key) => (
        <Link
          key={key}
          href={`${base}?filter=${key}${search ? `&q=${encodeURIComponent(search)}` : ""}${store ? `&store=${encodeURIComponent(store)}` : ""}`}
          className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${
            key === current ? "bg-[#161616] text-white shadow-sm" : "bg-white text-black/60 ring-1 ring-black/5 hover:text-black hover:ring-black/15"
          }`}
        >
          {FILTER_LABELS[key]}
        </Link>
      ))}
      <form action={base} className="flex w-full gap-2 sm:ml-auto sm:w-auto">
        <input type="hidden" name="filter" value={current} />
        <input
          name="q"
          defaultValue={search}
          placeholder="Number, mobile or name"
          className="w-full min-w-0 rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none transition focus:border-[#ff5e79] focus:ring-4 focus:ring-[#ff5e79]/10 sm:w-56"
        />
        <button className="rounded-full bg-[#ff5e79] px-4 py-2 text-sm font-bold text-white shadow-sm shadow-[#ff5e79]/30">Search</button>
      </form>
    </div>
  );
}

function rawSlaOf(t: Ticket) {
  return {
    status: t.status,
    acknowledged_at: t.acknowledgedAt,
    ack_due_at: t.ackDueAt,
    resolution_due_at: t.resolutionDueAt,
  };
}

export function TicketTable({ tickets, base, emptyText }: { tickets: Ticket[]; base: string; emptyText: string }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center text-sm text-black/55 soft-card ring-1 ring-black/5">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
      <ul className="divide-y divide-black/5">
        {tickets.map((t) => {
          const overdue = slaState(rawSlaOf(t)).state === "overdue";
          const accent =
            (t.type === "service" && t.priority === "safety") || (t.type === "complaint" && t.severity === "critical") || overdue
              ? "bg-red-500"
              : t.priority === "high"
                ? "bg-orange-400"
                : ["resolved", "closed", "cancelled"].includes(t.status)
                  ? "bg-black/10"
                  : t.status === "open"
                    ? "bg-amber-400"
                    : "bg-[#11b8d0]";
          return (
          <li key={t.id} className="relative">
            <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${accent}`} aria-hidden />
            <Link href={`${base}/${t.id}`} className="group block px-5 py-4 pl-6 transition hover:bg-[#f7f9fb]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-black/50">{t.number}</span>
                <StatusBadge status={t.status} label={statusLabel(t.status)} />
                <PriorityBadge priority={t.priority} type={t.type} severity={t.severity} />
                <EscalationBadge level={t.escalationLevel} />
                <SlaBadge ticket={t} />
              </div>
              <p className="mt-2 font-semibold group-hover:text-[#ff5e79]">
                {t.title}
                {t.productName ? <span className="font-normal text-black/55"> — {t.productName}</span> : null}
              </p>
              <p className="mt-1 text-sm text-black/55">
                {t.contactName ?? "Customer"} · {t.contactMobile ?? "—"} · {t.storeName ?? "No store"} ·{" "}
                {t.assigneeName ? `With ${t.assigneeName}` : "Not assigned"} · Raised {formatDateTime(t.createdAt)}
              </p>
            </Link>
          </li>
          );
        })}
      </ul>
    </div>
  );
}

export function parseFilter(value: string | string[] | undefined, fallback: ListFilter = "action"): ListFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return (["action", "new", "overdue", "mine", "active", "closed", "all"] as ListFilter[]).includes(v as ListFilter)
    ? (v as ListFilter)
    : fallback;
}
