// Staff list + detail screens, shared by Service Requests and Complaints.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { canSeeComplaints, canSeeService, ROLE_LABELS } from "@/lib/roles";
import { formatDate, formatDateTime, statusLabel } from "@/lib/helpers";
import {
  COMPLAINT_RESOLUTIONS,
  COMPLAINT_SEVERITIES,
  PRIORITIES,
  SERVICE_RESOLUTIONS,
  SERVICE_SEVERITIES,
  type TicketType,
} from "@/lib/sla";
import {
  assignableStaff,
  availableActions,
  canViewTicket,
  getHistory,
  getTicket,
  listTickets,
} from "@/lib/tickets";
import { StatusBadge } from "@/components/SiteChrome";
import { EscalationBadge, FilterTabs, parseFilter, PriorityBadge, SlaBadge, TicketTable } from "@/components/TicketUI";
import { TicketActions } from "@/components/TicketActions";

const BASE: Record<TicketType, string> = { service: "/staff/service", complaint: "/staff/complaints" };
const TITLE: Record<TicketType, string> = { service: "Service Requests", complaint: "Complaints" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export async function TicketListPage({ type, searchParams }: { type: TicketType; searchParams: SearchParams }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (type === "service" ? !canSeeService(staff.role) : !canSeeComplaints(staff.role)) redirect("/staff");

  const params = await searchParams;
  const filter = parseFilter(params.filter);
  const search = typeof params.q === "string" ? params.q.slice(0, 60) : "";
  const tickets = await listTickets(staff, type, filter, search);

  const scope =
    staff.role === "store_manager" || staff.role === "technician"
      ? `Showing ${staff.storeName ?? "your store"}${staff.role === "technician" ? " and jobs assigned to you" : ""}.`
      : "Showing all stores.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{TITLE[type]}</h1>
        <p className="mt-2 text-sm text-black/60">
          {scope} Most urgent first: overdue, then safety, then nearest deadline.
        </p>
        {(staff.role === "store_manager" || staff.role === "technician") && !staff.storeName && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Your account has no store set, so no store requests are shown. Ask the administrator to set your store.
          </p>
        )}
      </div>
      <FilterTabs base={BASE[type]} current={filter} search={search} />
      <TicketTable
        tickets={tickets}
        base={BASE[type]}
        emptyText={filter === "action" ? "Nothing is waiting for you right now. 🎉" : "No requests found."}
      />
    </div>
  );
}

export async function TicketDetailPage({ type, params }: { type: TicketType; params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");

  const { id } = await params;
  const ticket = await getTicket(type, id);
  if (!ticket || !canViewTicket(staff, type, ticket)) notFound();

  const [history, people] = await Promise.all([getHistory(type, id), assignableStaff(type, ticket.storeName)]);
  const actions = availableActions(staff, ticket);

  const details: { label: string; value: string | null }[] = [
    { label: "Customer", value: ticket.contactName },
    { label: "Mobile", value: ticket.contactMobile },
    { label: "E-mail", value: ticket.contactEmail },
    { label: "Store", value: ticket.storeName },
    { label: "Product", value: ticket.productName },
    { label: "Warranty No.", value: ticket.warrantyNumber ?? null },
    { label: "Reference", value: ticket.referenceNumber ?? null },
    {
      label: "Service type",
      value: ticket.serviceMode ? (ticket.serviceMode === "home_visit" ? "Home visit / pickup" : "Customer brings to store") : null,
    },
    { label: "Preferred date", value: ticket.preferredDate ? formatDate(ticket.preferredDate) : null },
    { label: "Address", value: ticket.address ?? null },
    {
      label: "Coverage",
      value: ticket.underWarranty === null || ticket.underWarranty === undefined ? null : ticket.underWarranty ? "Under warranty" : "Out of warranty (chargeable)",
    },
    { label: "Classification", value: ticket.severity ? statusLabel(ticket.severity) : "Not classified yet" },
    { label: type === "service" ? "Technician" : "Owner", value: ticket.assigneeName ?? "Not assigned" },
    { label: "Raised", value: formatDateTime(ticket.createdAt) },
    { label: "Acknowledged", value: ticket.acknowledgedAt ? formatDateTime(ticket.acknowledgedAt) : "Not yet" },
    { label: "Resolve by", value: ticket.resolutionDueAt ? formatDateTime(ticket.resolutionDueAt) : null },
    { label: "Resolved", value: ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : null },
    { label: "Closed", value: ticket.closedAt ? formatDateTime(ticket.closedAt) : null },
  ];

  const mapLink =
    ticket.latitude && ticket.longitude
      ? `https://www.google.com/maps?q=${ticket.latitude},${ticket.longitude}`
      : null;

  return (
    <div className="space-y-6">
      <Link href={BASE[type]} className="text-sm font-semibold text-black/50 hover:text-black">
        ← {TITLE[type]}
      </Link>

      <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-black/50">{ticket.number}</span>
          <StatusBadge status={ticket.status} label={statusLabel(ticket.status)} />
          <PriorityBadge priority={ticket.priority} />
          <EscalationBadge level={ticket.escalationLevel} />
          <SlaBadge ticket={ticket} />
        </div>
        <h1 className="mt-3 text-2xl font-bold">{ticket.title}</h1>
        <p className="mt-3 whitespace-pre-line text-sm leading-6 text-black/70">{ticket.description}</p>

        {ticket.priority === "safety" && (
          <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-800">
            Safety issue: call the customer now and ask them to stop using the product until it is checked.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {ticket.contactMobile && (
            <>
              <a href={`tel:+91${ticket.contactMobile}`} className="rounded-xl bg-[#161616] px-4 py-2 font-bold text-white">
                📞 Call customer
              </a>
              <a
                href={`https://wa.me/91${ticket.contactMobile}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl bg-[#25d366] px-4 py-2 font-bold text-white"
              >
                WhatsApp customer
              </a>
            </>
          )}
          {mapLink && (
            <a href={mapLink} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-black/10 px-4 py-2 font-bold">
              📍 Customer location
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <dl className="grid gap-4 rounded-3xl bg-white p-5 text-sm shadow-sm ring-1 ring-black/5 sm:grid-cols-2 sm:p-6">
            {details
              .filter((d) => d.value)
              .map((d) => (
                <div key={d.label}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-black/40">{d.label}</dt>
                  <dd className="mt-1 font-semibold">{d.value}</dd>
                </div>
              ))}
          </dl>

          <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5 sm:p-6">
            <h2 className="text-lg font-bold">Timeline</h2>
            <ol className="mt-4 space-y-4 border-l-2 border-black/10 pl-5">
              {[...history].reverse().map((item, index) => (
                <li key={`${item.createdAt}-${index}`} className="relative">
                  <span
                    className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
                      item.visibility === "internal" ? "bg-black/30" : "bg-[#ff5e79]"
                    }`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold">{statusLabel(item.action === "created" ? "received" : item.action ?? item.status)}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        item.visibility === "internal" ? "bg-black/5 text-black/50" : "bg-[#11b8d0]/10 text-[#0e8fa3]"
                      }`}
                    >
                      {item.visibility === "internal" ? "Staff only" : "Customer sees"}
                    </span>
                  </div>
                  <p className="text-xs text-black/50">
                    {formatDateTime(item.createdAt)}
                    {item.actorName ? ` · ${item.actorName}` : ""}
                  </p>
                  {item.note && <p className="mt-1 whitespace-pre-line text-sm text-black/70">{item.note}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <TicketActions
          type={type}
          id={ticket.id}
          actions={actions}
          people={people.map((p) => ({
            id: p.id,
            label: `${p.fullName} — ${ROLE_LABELS[p.role]}${p.storeName ? `, ${p.storeName}` : ""}`,
          }))}
          currentAssigneeId={ticket.assigneeId}
          severity={ticket.severity}
          priority={ticket.priority}
          severities={type === "service" ? SERVICE_SEVERITIES : COMPLAINT_SEVERITIES}
          priorities={PRIORITIES}
          resolutions={type === "service" ? SERVICE_RESOLUTIONS : COMPLAINT_RESOLUTIONS}
        />
      </div>
    </div>
  );
}
