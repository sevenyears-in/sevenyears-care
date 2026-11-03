import Link from "next/link";
import { getCurrentStaff } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zohoConfigured } from "@/lib/zoho";
import { todayISO } from "@/lib/helpers";
import { canSeeComplaints, canSeeService, isAdmin, isCorporateStaff, ROLE_LABELS } from "@/lib/roles";
import { slaState } from "@/lib/sla";
import { listTickets, needsActionFrom, rawSla, seesAllStores, type Ticket } from "@/lib/tickets";
import type { StaffUser } from "@/lib/auth";
import { TicketTable } from "@/components/TicketUI";
import { InstallAppCard } from "@/components/InstallApp";

export default async function StaffDashboard() {
  const staff = await getCurrentStaff();
  if (!staff) return null;
  const today = todayISO();

  const showService = canSeeService(staff.role);
  const showComplaints = canSeeComplaints(staff.role);

  const [todayCount, totalCount, categoryCount, serviceTickets, complaintTickets, demo] = await Promise.all([
    supabaseAdmin
      .from("warranties")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${today}T00:00:00+05:30`),
    supabaseAdmin.from("warranties").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("warranty_categories")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    showService ? listTickets(staff, "service", "active") : Promise.resolve([] as Ticket[]),
    showComplaints ? listTickets(staff, "complaint", "active") : Promise.resolve([] as Ticket[]),
    zohoConfigured().then((ok) => !ok),
  ]);

  const noCategories = (categoryCount.count ?? 0) === 0;

  return (
    <div className="space-y-8">
      <InstallAppCard />
      <div>
        <p className="text-sm font-semibold text-[#ff5e79]">Welcome back</p>
        <h1 className="mt-1 text-3xl font-bold">{staff.fullName}</h1>
        <p className="mt-1 text-sm text-black/50">
          {ROLE_LABELS[staff.role]}
          {staff.storeName ? ` · ${staff.storeName}` : ""}
        </p>
      </div>

      {demo && isAdmin(staff.role) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Zoho POS is not connected yet — demo mode</p>
          <p className="mt-1">
            Fetching any bill number returns a sample bill so you can try the screens.
            {staff.role === "super_admin" ? (
              <>
                {" "}
                <Link href="/staff/admin/zoho" className="font-bold underline">
                  Connect Zoho POS
                </Link>{" "}
                to fetch real bills.
              </>
            ) : (
              " Only the Super Admin can connect Zoho POS."
            )}
          </p>
        </div>
      )}

      {noCategories && isAdmin(staff.role) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-bold">No warranty categories set up</p>
          <p className="mt-1">
            Items only appear for registration when their Zoho POS category is in the warranty list.{" "}
            <Link href="/staff/admin/categories" className="font-bold underline">
              Add categories now
            </Link>
          </p>
        </div>
      )}

      {(isCorporateStaff(staff) || seesAllStores(staff, "service")) && (showService || showComplaints) && (
        <StoreBreakdown
          service={showService ? serviceTickets : null}
          complaints={showComplaints ? complaintTickets : null}
        />
      )}

      {showService && (
        <QueueSection
          title="Service Requests"
          base="/staff/service"
          staff={staff}
          tickets={serviceTickets}
          extra={
            staff.role === "service_head" || staff.role === "super_admin"
              ? { label: "Awaiting your approval", value: serviceTickets.filter((t) => t.status === "awaiting_approval").length }
              : staff.role === "technician" || serviceTickets.some((t) => t.assigneeId === staff.id)
                ? { label: "Assigned to me", value: serviceTickets.filter((t) => t.assigneeId === staff.id).length }
                : { label: "Not assigned", value: serviceTickets.filter((t) => !t.assigneeId).length }
          }
        />
      )}

      {showComplaints && (
        <QueueSection
          title="Complaints"
          base="/staff/complaints"
          staff={staff}
          tickets={complaintTickets}
          extra={{ label: "Not assigned", value: complaintTickets.filter((t) => !t.assigneeId).length }}
        />
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-bold">Warranties</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Registered today" value={todayCount.count ?? 0} />
          <Stat label="Total warranties" value={totalCount.count ?? 0} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/staff/register" className="rounded-3xl bg-[#161616] p-6 text-white transition hover:opacity-95">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/50">At billing</p>
            <h3 className="mt-2 text-2xl font-bold">Register Warranty</h3>
            <p className="mt-2 text-sm text-white/60">
              Fetch the bill from Zoho POS, fill model and serial numbers, and generate certificates.
            </p>
            <span className="mt-5 inline-block rounded-2xl bg-[#ff5e79] px-5 py-3 text-sm font-bold">Start →</span>
          </Link>
          <Link href="/staff/warranties" className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-black/40">Look up</p>
            <h3 className="mt-2 text-2xl font-bold">Find a Warranty</h3>
            <p className="mt-2 text-sm text-black/55">
              Search by bill number, warranty number, mobile or serial number and re-download certificates.
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Store-wise open / overdue counts (Corporate Office, Directors, Service Head). */
function StoreBreakdown({ service, complaints }: { service: Ticket[] | null; complaints: Ticket[] | null }) {
  const stores = new Map<string, { s: number; so: number; c: number; co: number }>();
  const bump = (t: Ticket, kind: "s" | "c") => {
    const key = t.storeName?.trim() || "Not specified";
    const row = stores.get(key) ?? { s: 0, so: 0, c: 0, co: 0 };
    const overdue = slaState(rawSla(t)).state === "overdue";
    if (kind === "s") {
      row.s++;
      if (overdue) row.so++;
    } else {
      row.c++;
      if (overdue) row.co++;
    }
    stores.set(key, row);
  };
  (service ?? []).forEach((t) => bump(t, "s"));
  (complaints ?? []).forEach((t) => bump(t, "c"));
  const rows = [...stores.entries()].sort((a, b) => b[1].so + b[1].co - (a[1].so + a[1].co) || a[0].localeCompare(b[0]));
  const totals = rows.reduce(
    (acc, [, r]) => ({ s: acc.s + r.s, so: acc.so + r.so, c: acc.c + r.c, co: acc.co + r.co }),
    { s: 0, so: 0, c: 0, co: 0 }
  );
  const cell = (value: number, href: string | null, danger = false) => (
    <td className={`px-3 py-3 text-right ${danger && value > 0 ? "font-bold text-red-700" : value ? "font-semibold" : "text-black/30"}`}>
      {href && value ? (
        <Link href={href} className="hover:underline">
          {value}
        </Link>
      ) : (
        value
      )}
    </td>
  );
  const link = (base: string, filter: string, store: string) =>
    store === "Not specified" ? null : `${base}?filter=${filter}&store=${encodeURIComponent(store)}`;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold">Store-wise</h2>
      <div className="overflow-x-auto rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-[#f7f9fb] text-xs uppercase tracking-wider text-black/45">
            <tr>
              <th className="px-4 py-3 text-left">Store</th>
              {service && <th className="px-3 py-3 text-right">Service open</th>}
              {service && <th className="px-3 py-3 text-right">Service overdue</th>}
              {complaints && <th className="px-3 py-3 text-right">Complaints open</th>}
              {complaints && <th className="px-3 py-3 text-right">Complaints overdue</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-black/50">
                  Nothing open in any store. 🎉
                </td>
              </tr>
            ) : (
              rows.map(([store, r]) => (
                <tr key={store}>
                  <td className="px-4 py-3 font-semibold">{store}</td>
                  {service && cell(r.s, link("/staff/service", "active", store))}
                  {service && cell(r.so, link("/staff/service", "overdue", store), true)}
                  {complaints && cell(r.c, link("/staff/complaints", "active", store))}
                  {complaints && cell(r.co, link("/staff/complaints", "overdue", store), true)}
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="border-t border-black/10 bg-[#f7f9fb]">
              <tr>
                <td className="px-4 py-3 font-bold">All stores</td>
                {service && cell(totals.s, null)}
                {service && cell(totals.so, null, true)}
                {complaints && cell(totals.c, null)}
                {complaints && cell(totals.co, null, true)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function QueueSection({
  title,
  base,
  staff,
  tickets,
  extra,
}: {
  title: string;
  base: string;
  staff: StaffUser;
  tickets: Ticket[];
  extra: { label: string; value: number };
}) {
  const mine = tickets.filter((t) => needsActionFrom(staff, t));
  const fresh = tickets.filter((t) => t.status === "open").length;
  const overdue = tickets.filter((t) => slaState(rawSla(t)).state === "overdue").length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xl font-bold">{title}</h2>
        <Link href={base} className="text-sm font-bold text-[#ff5e79]">
          Open queue →
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Needs my action" value={mine.length} href={`${base}?filter=action`} highlight={mine.length > 0} />
        <Stat label="New (not acknowledged)" value={fresh} href={`${base}?filter=new`} />
        <Stat label="Overdue" value={overdue} href={`${base}?filter=overdue`} danger={overdue > 0} />
        <Stat label={extra.label} value={extra.value} href={`${base}?filter=active`} />
      </div>
      {mine.length > 0 && <TicketTable tickets={mine.slice(0, 5)} base={base} emptyText="" />}
    </section>
  );
}

function Stat({
  label,
  value,
  href,
  highlight,
  danger,
}: {
  label: string;
  value: number;
  href?: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  const body = (
    <div
      className={`h-full rounded-3xl p-5 shadow-sm ring-1 transition ${
        danger ? "bg-red-50 ring-red-200" : highlight ? "bg-[#ff5e79]/5 ring-[#ff5e79]/30" : "bg-white ring-black/5"
      } ${href ? "hover:shadow-md" : ""}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-black/40">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${danger ? "text-red-700" : ""}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
