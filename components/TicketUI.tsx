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
  counts,
}: {
  base: string;
  current: ListFilter;
  search: string;
  store?: string;
  counts?: Partial<Record<ListFilter, number>>;
}) {
  const q = (key: ListFilter) =>
    `${base}?filter=${key}${search ? `&q=${encodeURIComponent(search)}` : ""}${store ? `&store=${encodeURIComponent(store)}` : ""}`;

  return (
    <div className="space-y-3">
      {/* One bar of tabs; on phones it scrolls sideways instead of wrapping. */}
      <div className="-mx-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
        <nav className="inline-flex min-w-max gap-1 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-black/5" aria-label="Filter">
          {(Object.keys(FILTER_LABELS) as ListFilter[]).map((key) => {
            const active = key === current;
            const n = counts?.[key];
            const urgent = (key === "action" || key === "overdue") && (n ?? 0) > 0;
            return (
              <Link
                key={key}
                href={q(key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-semibold transition ${
                  active
                    ? "bg-[linear-gradient(135deg,#ff5e79,#8883d7)] text-white shadow-sm"
                    : "text-black/60 hover:bg-[#f7f9fb] hover:text-black"
                }`}
              >
                {urgent && !active && <span className="h-1.5 w-1.5 rounded-full bg-[#ff5e79]" aria-hidden />}
                {FILTER_LABELS[key]}
                {n !== undefined && (
                  <span
                    className={`rounded-md px-1.5 text-[11px] font-bold leading-5 tabular-nums ${
                      active ? "bg-white/25 text-white" : urgent ? "bg-[#ff5e79]/12 text-[#d43852]" : n > 0 ? "bg-black/[0.06] text-black/70" : "text-black/30"
                    }`}
                  >
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
      <form action={base} className="flex gap-2 sm:max-w-md">
        <input type="hidden" name="filter" value={current} />
        <input
          name="q"
          defaultValue={search}
          placeholder="Search number, mobile or name"
          className="w-full min-w-0 rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[#ff5e79] focus:ring-4 focus:ring-[#ff5e79]/10"
        />
        <button className="shrink-0 rounded-xl bg-[#161616] px-4 py-2.5 text-sm font-bold text-white">Search</button>
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
                {t.paid && (
                  <span className="rounded-full bg-[#f39237] px-2.5 py-1 text-xs font-bold text-white">
                    PAID{t.quoteStatus === "pending" ? " · quote sent" : t.quoteStatus === "approved" ? " · approved" : t.quoteStatus === "declined" ? " · declined" : ""}
                  </span>
                )}
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
