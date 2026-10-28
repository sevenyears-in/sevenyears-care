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
        : "bg-black/5 text-black/60";

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${colour}`}>
      {sla.state === "overdue" ? "⏰ " : ""}
      {sla.label}
      {sla.due && sla.state !== "overdue" ? ` ${formatDateTime(sla.due)}` : ""}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "safety")
    return <span className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">⚠ SAFETY</span>;
  if (priority === "high")
    return <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800">High</span>;
  return null;
}

export function EscalationBadge({ level }: { level: number }) {
  if (!level) return null;
  return (
    <span className="inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700 ring-1 ring-red-200">
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

export function FilterTabs({ base, current, search }: { base: string; current: ListFilter; search: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(FILTER_LABELS) as ListFilter[]).map((key) => (
        <Link
          key={key}
          href={`${base}?filter=${key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            key === current ? "bg-[#161616] text-white" : "bg-white text-black/60 ring-1 ring-black/5 hover:text-black"
          }`}
        >
          {FILTER_LABELS[key]}
        </Link>
      ))}
      <form action={base} className="ml-auto flex gap-2">
        <input type="hidden" name="filter" value={current} />
        <input
          name="q"
          defaultValue={search}
          placeholder="Number, mobile or name"
          className="w-52 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-[#ff5e79]"
        />
        <button className="rounded-xl bg-[#ff5e79] px-3 py-2 text-sm font-bold text-white">Search</button>
      </form>
    </div>
  );
}

export function TicketTable({ tickets, base, emptyText }: { tickets: Ticket[]; base: string; emptyText: string }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center text-sm text-black/55 shadow-sm ring-1 ring-black/5">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
      <ul className="divide-y divide-black/5">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link href={`${base}/${t.id}`} className="block px-5 py-4 transition hover:bg-[#f7f9fb]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-black/50">{t.number}</span>
                <StatusBadge status={t.status} label={statusLabel(t.status)} />
                <PriorityBadge priority={t.priority} />
                <EscalationBadge level={t.escalationLevel} />
                <SlaBadge ticket={t} />
              </div>
              <p className="mt-2 font-bold">
                {t.title}
                {t.productName ? <span className="font-normal text-black/55"> — {t.productName}</span> : null}
              </p>
              <p className="mt-1 text-sm text-black/55">
                {t.contactName ?? "Customer"} · {t.contactMobile ?? "—"} · {t.storeName ?? "No store"} ·{" "}
                {t.assigneeName ? `With ${t.assigneeName}` : "Not assigned"} · Raised {formatDateTime(t.createdAt)}
              </p>
            </Link>
          </li>
        ))}
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
