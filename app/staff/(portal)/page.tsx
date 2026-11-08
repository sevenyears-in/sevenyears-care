import { WhoIsIn } from "@/components/WhoIsIn";
import { after } from "next/server";
import { runWishes } from "@/lib/wishes";
import type { ReactNode } from "react";
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
import { ExtendedWarrantySection } from "@/components/ExtendedWarrantySection";
import { canSeeExtensions } from "@/lib/extended-access";
import { hasSection } from "@/lib/access";

export default async function StaffDashboard() {
  const staff = await getCurrentStaff();
  // Birthday & anniversary wishes go out once a day even without a scheduled job.
  after(() => runWishes().catch((e) => console.error("Wishes run failed:", e)));
  if (!staff) return null;
  const today = todayISO();

  const showService = hasSection(staff, "service");
  const showComplaints = hasSection(staff, "complaints");

  const [todayCount, totalCount, categoryCount, serviceTickets, complaintTickets, demo, serviceClosed, complaintClosed] = await Promise.all([
    supabaseAdmin
      .from("warranties")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${today}T00:00:00+05:30`)
      .neq("source", "zoho_import"), // only warranties registered at the store counter
    supabaseAdmin.from("warranties").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("warranty_categories")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    showService ? listTickets(staff, "service", "active") : Promise.resolve([] as Ticket[]),
    showComplaints ? listTickets(staff, "complaint", "active") : Promise.resolve([] as Ticket[]),
    zohoConfigured().then((ok) => !ok),
    showService ? listTickets(staff, "service", "closed") : Promise.resolve([] as Ticket[]),
    showComplaints ? listTickets(staff, "complaint", "closed") : Promise.resolve([] as Ticket[]),
  ]);

  const noCategories = (categoryCount.count ?? 0) === 0;

  return (
    <div className="space-y-8">
      <InstallAppCard />
      <div className="brand-wash soft-card relative overflow-hidden rounded-3xl bg-white px-6 py-6 ring-1 ring-black/5 sm:px-8 sm:py-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Welcome back</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{staff.fullName}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-[#8883d7]/15 px-3 py-1 text-[#5c57b0]">{ROLE_LABELS[staff.role]}</span>
          {staff.storeName && <span className="rounded-full bg-[#11b8d0]/15 px-3 py-1 text-[#0b7f90]">{staff.storeName}</span>}
        </div>
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
          closedCount={serviceClosed.length}
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
          closedCount={complaintClosed.length}
          extra={{ label: "Not assigned", value: complaintTickets.filter((t) => !t.assigneeId).length }}
        />
      )}

      {hasSection(staff, "extended") && <ExtendedWarrantySection staff={staff} />}

      <WhoIsIn staff={staff} />

      <section className="space-y-4">
        <h2 className="text-xl font-bold">Warranties</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="Registered today" value={todayCount.count ?? 0} accent="#0fa8bf" icon="today" />
          <Stat label="Total warranties" value={totalCount.count ?? 0} accent="#8883d7" icon="shield" href="/staff/warranties" />
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
          <Link href="/staff/warranties" className="rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5 transition hover:shadow-md">
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
const STORE_COLOURS = ["#ff5e79", "#8883d7", "#ffa95a", "#11b8d0"]; // logo colours

function StoreBreakdown({ service, complaints }: { service: Ticket[] | null; complaints: Ticket[] | null }) {
  type Counts = { open: number; overdue: number };
  const stores = new Map<string, { service: Counts; complaints: Counts }>();
  const bump = (t: Ticket, kind: "service" | "complaints") => {
    const key = t.storeName?.trim() || "Not specified";
    const row = stores.get(key) ?? { service: { open: 0, overdue: 0 }, complaints: { open: 0, overdue: 0 } };
    row[kind].open++;
    if (slaState(rawSla(t)).state === "overdue") row[kind].overdue++;
    stores.set(key, row);
  };
  (service ?? []).forEach((t) => bump(t, "service"));
  (complaints ?? []).forEach((t) => bump(t, "complaints"));

  const overdueOf = (r: { service: Counts; complaints: Counts }) => r.service.overdue + r.complaints.overdue;
  const openOf = (r: { service: Counts; complaints: Counts }) => r.service.open + r.complaints.open;
  const rows = [...stores.entries()].sort(
    (a, b) => overdueOf(b[1]) - overdueOf(a[1]) || openOf(b[1]) - openOf(a[1]) || a[0].localeCompare(b[0])
  );
  const total = rows.reduce(
    (acc, [, r]) => ({ open: acc.open + openOf(r), overdue: acc.overdue + overdueOf(r) }),
    { open: 0, overdue: 0 }
  );
  const maxOpen = Math.max(1, ...rows.map(([, r]) => openOf(r)));
  const link = (base: string, filter: string, store: string) =>
    store === "Not specified" ? undefined : `${base}?filter=${filter}&store=${encodeURIComponent(store)}`;

  const Metric = ({ label, icon, counts, base, store }: { label: string; icon: string; counts: Counts; base: string; store: string }) => {
    const openHref = link(base, "active", store);
    const overdueHref = link(base, "overdue", store);
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f7f9fb] px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-black/55">
          <span aria-hidden>{icon}</span>
          {label}
        </div>
        <div className="flex items-center gap-2">
          {openHref && counts.open ? (
            <Link href={openHref} className="text-xl font-bold hover:text-[#ff5e79]">
              {counts.open}
            </Link>
          ) : (
            <span className={`text-xl font-bold ${counts.open ? "" : "text-black/25"}`}>{counts.open}</span>
          )}
          {counts.overdue > 0 ? (
            <Link
              href={overdueHref ?? "#"}
              className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100"
            >
              {counts.overdue} overdue
            </Link>
          ) : counts.open > 0 ? (
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-700 ring-1 ring-green-200">
              On time
            </span>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <section className="overflow-hidden rounded-3xl bg-white soft-card ring-1 ring-black/5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/5 bg-gradient-to-r from-[#8883d7]/10 via-[#ff5e79]/5 to-[#11b8d0]/10 px-5 py-5 sm:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8883d7]">All stores</p>
          <h2 className="mt-1 text-xl font-bold">Store-wise status</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-white px-3 py-1.5 soft-card ring-1 ring-black/5">
            {rows.length} {rows.length === 1 ? "store" : "stores"}
          </span>
          <span className="rounded-full bg-white px-3 py-1.5 soft-card ring-1 ring-black/5">{total.open} open</span>
          <span
            className={`rounded-full px-3 py-1.5 shadow-sm ring-1 ${
              total.overdue ? "bg-red-50 text-red-700 ring-red-200" : "bg-green-50 text-green-700 ring-green-200"
            }`}
          >
            {total.overdue ? `${total.overdue} overdue` : "Nothing overdue"}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-black/50">Nothing open in any store. 🎉</p>
      ) : (
        <ul className="divide-y divide-black/5">
          {rows.map(([store, r], i) => {
            const colour = STORE_COLOURS[i % STORE_COLOURS.length];
            const late = overdueOf(r) > 0;
            return (
              <li key={store} className={`px-5 py-4 sm:px-6 ${late ? "bg-red-50/30" : ""}`}>
                <div className="grid items-center gap-3 lg:grid-cols-[220px_1fr]">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white"
                      style={{ backgroundColor: colour }}
                      aria-hidden
                    >
                      {store.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{store}</p>
                      <div className="mt-1.5 h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-black/5">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round((openOf(r) / maxOpen) * 100)}%`, backgroundColor: colour }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className={`grid gap-2 ${service && complaints ? "sm:grid-cols-2" : ""}`}>
                    {service && <Metric label="Service" icon="🛠️" counts={r.service} base="/staff/service" store={store} />}
                    {complaints && (
                      <Metric label="Complaints" icon="💬" counts={r.complaints} base="/staff/complaints" store={store} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function QueueSection({
  title,
  base,
  staff,
  tickets,
  closedCount,
  extra,
}: {
  title: string;
  base: string;
  staff: StaffUser;
  tickets: Ticket[];
  closedCount: number;
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Needs my action" value={mine.length} href={`${base}?filter=action`} highlight={mine.length > 0} accent="#ff5e79" icon="action" />
        <Stat label="New" value={fresh} href={`${base}?filter=new`} accent="#f39237" icon="new" />
        <Stat label="Overdue" value={overdue} href={`${base}?filter=overdue`} danger={overdue > 0} accent="#d43852" icon="overdue" />
        <Stat
          label={extra.label}
          value={extra.value}
          href={`${base}?filter=${extra.label === "Assigned to me" ? "mine" : "active"}`}
          accent="#8883d7"
          icon={extra.label === "Awaiting your approval" ? "approve" : "people"}
        />
        <Stat label="All open" value={tickets.length} href={`${base}?filter=active`} accent="#0fa8bf" icon="open" />
        <Stat
          icon="done"
          label="Resolved / closed"
          value={closedCount}
          display={closedCount >= 300 ? "300+" : undefined}
          href={`${base}?filter=closed`}
          accent="#16a34a"
        />
      </div>
      {mine.length > 0 && <TicketTable tickets={mine.slice(0, 5)} base={base} emptyText="" />}
    </section>
  );
}

const ICONS: Record<string, ReactNode> = {
  action: <path d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  new: <path d="M12 5v14M5 12h14" />,
  overdue: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  people: <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm13 9v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />,
  approve: <path d="M9 12l2 2 4-4M7.8 4.4a3 3 0 0 0 1.7-.7 3 3 0 0 1 5 0 3 3 0 0 0 1.7.7 3 3 0 0 1 2.7 2.7 3 3 0 0 0 .7 1.7 3 3 0 0 1 0 5 3 3 0 0 0-.7 1.7 3 3 0 0 1-2.7 2.7 3 3 0 0 0-1.7.7 3 3 0 0 1-5 0 3 3 0 0 0-1.7-.7 3 3 0 0 1-2.7-2.7 3 3 0 0 0-.7-1.7 3 3 0 0 1 0-5 3 3 0 0 0 .7-1.7 3 3 0 0 1 2.7-2.7Z" />,
  open: <path d="M4 6h16M4 12h16M4 18h10" />,
  done: <path d="M20 6 9 17l-5-5" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  today: <path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />,
};

function Stat({
  label,
  value,
  href,
  highlight,
  danger,
  accent = "#8883d7",
  display,
  icon = "open",
}: {
  label: string;
  value: number;
  href?: string;
  highlight?: boolean;
  danger?: boolean;
  accent?: string;
  display?: string;
  icon?: keyof typeof ICONS;
}) {
  const colour = danger ? "#d43852" : accent;
  const lit = value > 0 && (highlight || danger);
  const body = (
    <div
      className={`group relative flex h-full flex-col justify-between overflow-hidden rounded-3xl p-5 ring-1 transition duration-200 ${
        href ? "hover:-translate-y-0.5 hover:shadow-lg" : ""
      } ${lit ? "shadow-md" : "soft-card"}`}
      style={{
        background: lit ? `linear-gradient(135deg, ${colour}, ${colour}cc)` : `linear-gradient(135deg, #ffffff 55%, ${colour}12)`,
        // ring colour
        ["--tw-ring-color" as string]: lit ? "transparent" : `${colour}26`,
      }}
    >
      <span
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-60 blur-2xl"
        style={{ backgroundColor: lit ? "#ffffff40" : `${colour}22` }}
        aria-hidden
      />
      <div className="flex items-start justify-between">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-2xl"
          style={{ backgroundColor: lit ? "#ffffff33" : `${colour}1f`, color: lit ? "#fff" : colour }}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {ICONS[icon]}
          </svg>
        </span>
        {href && (
          <span className={`text-lg transition group-hover:translate-x-0.5 ${lit ? "text-white/70" : "text-black/20 group-hover:text-black/50"}`} aria-hidden>
            →
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className={`text-3xl font-bold leading-none tracking-tight tabular-nums ${lit ? "text-white" : value ? "text-[#161616]" : "text-black/30"}`}>
          {display ?? value}
        </p>
        <p className={`mt-2 text-[13px] font-semibold leading-tight ${lit ? "text-white/90" : "text-black/55"}`}>{label}</p>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
