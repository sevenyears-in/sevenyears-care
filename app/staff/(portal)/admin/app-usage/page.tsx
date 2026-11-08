import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin, ROLE_LABELS, type Role } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/helpers";

export const dynamic = "force-dynamic";
export const metadata = { title: "App usage" };

type Token = { platform: string; customer_mobile: string | null; staff_id: string | null; updated_at: string };
type StaffRow = { id: string; user_id: string; full_name: string; role: Role; store_name: string | null; last_login_at: string | null };
type View = { offer_id: string; viewer: string; customer_mobile: string | null; staff_id: string | null; first_seen_at: string; tapped_at: string | null };
type Alert = { staff_id: string; title: string; read_at: string | null; created_at: string };

const DAY = 86_400_000;
const since = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function Card({ title, value, note, colour }: { title: string; value: number | string; note?: string; colour: string }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: colour }} aria-hidden />
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/45">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {note && <p className="mt-1 text-xs text-black/50">{note}</p>}
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        {intro && <p className="mt-1 text-sm text-black/55">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-black/45";
const td = "px-3 py-2 align-top";
const yes = (on: boolean, label = "Yes") =>
  on ? <span className="font-bold text-green-700">✓ {label}</span> : <span className="text-black/30">—</span>;

export default async function AppUsagePage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  if (!isAdmin(staff.role)) redirect("/staff");

  const [tokensRes, staffRes, custCount, custRecent, offersRes, viewsRes, alertsRes] = await Promise.all([
    supabaseAdmin.from("push_tokens").select("platform, customer_mobile, staff_id, updated_at").limit(20000),
    supabaseAdmin.from("staff_users").select("id, user_id, full_name, role, store_name, last_login_at").eq("is_active", true).order("full_name"),
    supabaseAdmin.from("customer_accounts").select("mobile", { count: "exact", head: true }),
    supabaseAdmin.from("customer_accounts").select("mobile, full_name, last_login_at").not("last_login_at", "is", null).order("last_login_at", { ascending: false }).limit(5000),
    supabaseAdmin.from("offers").select("id, title, created_at, audience").order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("offer_views").select("offer_id, viewer, customer_mobile, staff_id, first_seen_at, tapped_at").gte("first_seen_at", since(120)).limit(20000),
    supabaseAdmin.from("staff_notifications").select("staff_id, title, read_at, created_at").gte("created_at", since(30)).order("created_at", { ascending: false }).limit(5000),
  ]);

  const tokens = (tokensRes.data ?? []) as Token[];
  const staffRows = (staffRes.data ?? []) as StaffRow[];
  const customers = (custRecent.data ?? []) as { mobile: string; full_name: string | null; last_login_at: string }[];
  const views = (viewsRes.data ?? []) as View[];
  const alerts = (alertsRes.data ?? []) as Alert[];
  const viewsMissing = Boolean(viewsRes.error);

  // Per person: Android app (last used) and browser notifications.
  const staffApp = new Map<string, string>();
  const staffWeb = new Set<string>();
  const custApp = new Map<string, string>();
  const custWeb = new Set<string>();
  let anonymousApp = 0;
  for (const t of tokens) {
    const isApp = t.platform !== "web";
    if (t.staff_id) {
      if (isApp) staffApp.set(t.staff_id, [staffApp.get(t.staff_id) ?? "", t.updated_at].sort().pop()!);
      else staffWeb.add(t.staff_id);
    }
    if (t.customer_mobile) {
      if (isApp) custApp.set(t.customer_mobile, [custApp.get(t.customer_mobile) ?? "", t.updated_at].sort().pop()!);
      else custWeb.add(t.customer_mobile);
    }
    if (!t.staff_id && !t.customer_mobile && isApp) anonymousApp++;
  }

  const staffName = new Map(staffRows.map((s) => [s.id, s.full_name]));
  const custName = new Map(customers.map((c) => [c.mobile, c.full_name]));
  const week = since(7);
  const month = since(30);

  // Staff alerts: sent / seen in the last 30 days, per person.
  const alertStats = new Map<string, { sent: number; seen: number }>();
  for (const a of alerts) {
    const s = alertStats.get(a.staff_id) ?? { sent: 0, seen: 0 };
    s.sent++;
    if (a.read_at) s.seen++;
    alertStats.set(a.staff_id, s);
  }

  // Customers worth listing: anyone who logged in, plus app users who are linked to a mobile.
  const custList = [...new Set([...customers.map((c) => c.mobile), ...custApp.keys(), ...custWeb])]
    .map((m) => ({
      mobile: m,
      name: custName.get(m) ?? null,
      lastLogin: customers.find((c) => c.mobile === m)?.last_login_at ?? null,
      app: custApp.get(m) ?? null,
      web: custWeb.has(m),
    }))
    .sort((a, b) => (b.app ?? b.lastLogin ?? "").localeCompare(a.app ?? a.lastLogin ?? ""))
    .slice(0, 300);

  const offers = (offersRes.data ?? []) as { id: string; title: string; created_at: string; audience: string | null }[];
  const who = (v: View) =>
    v.staff_id ? `${staffName.get(v.staff_id) ?? "Staff"} (staff)` : v.customer_mobile ? `${custName.get(v.customer_mobile) ?? "Customer"} · ${v.customer_mobile}` : v.viewer;

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl bg-white p-6 soft-card ring-1 ring-black/5">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,#ff5e79,#8883d7,#f39237,#0fa8bf)]" aria-hidden />
        <h1 className="text-3xl font-bold">App usage 📊</h1>
        <p className="mt-2 text-sm text-black/60">
          Who logs in, who has the Android app or browser notifications switched on, who has seen each offer, and who has seen their
          staff alerts. “App” means the Seven Years Care Android app; “Notifications on (browser)” means the website or iPhone home-screen
          app with notifications allowed.
        </p>
        <p className="mt-2 text-xs text-black/45">
          Phones do not tell us when a notification is merely shown, so an offer counts as <b>seen</b> when the person opens it from the
          notification or sees it on the Offers page / home page while logged in.
        </p>
        <Link href="/staff/admin/offers" className="mt-3 inline-block text-sm font-bold text-[#8883d7] hover:underline">
          ← Offers &amp; Notifications
        </Link>
      </div>

      <Section title="Staff">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Active staff" value={staffRows.length} colour="#8883d7" />
          <Card
            title="Logged in · last 7 days"
            value={staffRows.filter((s) => s.last_login_at && s.last_login_at >= week).length}
            note={`${staffRows.filter((s) => !s.last_login_at).length} never logged in`}
            colour="#ff5e79"
          />
          <Card title="Using the Android app" value={staffApp.size} colour="#0fa8bf" />
          <Card title="Notifications on (browser)" value={staffWeb.size} colour="#f39237" />
        </div>
        <div className="overflow-x-auto rounded-3xl bg-white soft-card ring-1 ring-black/5">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-black/5 bg-[#f7f9fb]">
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Role · store</th>
                <th className={th}>Last login</th>
                <th className={th}>Android app (last used)</th>
                <th className={th}>Browser notifications</th>
                <th className={th}>Alerts seen (30 days)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {staffRows.map((s) => {
                const a = alertStats.get(s.id);
                return (
                  <tr key={s.id}>
                    <td className={td}>
                      <p className="font-semibold">{s.full_name}</p>
                      <p className="text-xs text-black/45">{s.user_id}</p>
                    </td>
                    <td className={`${td} text-xs text-black/60`}>
                      {ROLE_LABELS[s.role] ?? s.role}
                      {s.store_name ? ` · ${s.store_name}` : ""}
                    </td>
                    <td className={`${td} text-xs`}>{s.last_login_at ? formatDateTime(s.last_login_at) : <span className="text-red-600">Never</span>}</td>
                    <td className={`${td} text-xs`}>{staffApp.has(s.id) ? yes(true, formatDateTime(staffApp.get(s.id)!)) : yes(false)}</td>
                    <td className={`${td} text-xs`}>{yes(staffWeb.has(s.id))}</td>
                    <td className={`${td} text-xs`}>
                      {a ? (
                        <span className={a.seen < a.sent ? "font-bold text-amber-700" : "font-bold text-green-700"}>
                          {a.seen} of {a.sent}
                        </span>
                      ) : (
                        <span className="text-black/30">No alerts</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Customers">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Customer accounts" value={custCount.count ?? 0} colour="#8883d7" />
          <Card
            title="Logged in · last 30 days"
            value={customers.filter((c) => c.last_login_at >= month).length}
            note={`${customers.length} have ever logged in`}
            colour="#ff5e79"
          />
          <Card title="Using the Android app" value={custApp.size} note={anonymousApp ? `+ ${anonymousApp} phone(s) with the app, not logged in` : undefined} colour="#0fa8bf" />
          <Card title="Notifications on (browser)" value={custWeb.size} colour="#f39237" />
        </div>
        {custList.length > 0 && (
          <details className="rounded-3xl bg-white p-4 soft-card ring-1 ring-black/5">
            <summary className="cursor-pointer text-sm font-bold">Show customers ({custList.length}{custList.length === 300 ? "+" : ""})</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b border-black/5 bg-[#f7f9fb]">
                  <tr>
                    <th className={th}>Customer</th>
                    <th className={th}>Last login</th>
                    <th className={th}>Android app (last used)</th>
                    <th className={th}>Browser notifications</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {custList.map((c) => (
                    <tr key={c.mobile}>
                      <td className={td}>
                        <p className="font-semibold">{c.name || "—"}</p>
                        <p className="text-xs text-black/45">{c.mobile}</p>
                      </td>
                      <td className={`${td} text-xs`}>{c.lastLogin ? formatDateTime(c.lastLogin) : "—"}</td>
                      <td className={`${td} text-xs`}>{c.app ? yes(true, formatDateTime(c.app)) : yes(false)}</td>
                      <td className={`${td} text-xs`}>{yes(c.web)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Section>

      <Section title="Who saw the offers" intro="Last 10 offers. Counting started on 8 Nov 2026 — earlier views were not recorded.">
        {viewsMissing && (
          <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">Offer views are not set up in the database yet. Run the latest database update.</p>
        )}
        {offers.length === 0 ? (
          <p className="rounded-3xl bg-white p-6 text-center text-sm text-black/55 soft-card ring-1 ring-black/5">No offers yet.</p>
        ) : (
          offers.map((o) => {
            const list = views.filter((v) => v.offer_id === o.id).sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at));
            const tapped = list.filter((v) => v.tapped_at).length;
            const staffSeen = list.filter((v) => v.staff_id).length;
            return (
              <details key={o.id} className="rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                  <span>
                    <span className="font-bold">{o.title}</span>
                    <span className="ml-2 text-xs text-black/45">{formatDateTime(o.created_at)}</span>
                  </span>
                  <span className="flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-[#8883d7]/15 px-2.5 py-1 text-[#5d58b5]">👀 Seen by {list.length}</span>
                    <span className="rounded-full bg-[#0fa8bf]/15 px-2.5 py-1 text-[#0b7f90]">🔔 {tapped} opened the notification</span>
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-black/55">
                      {list.length - staffSeen} customers · {staffSeen} staff
                    </span>
                  </span>
                </summary>
                {list.length === 0 ? (
                  <p className="mt-3 text-sm text-black/50">Nobody yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-black/5 text-sm">
                    {list.map((v) => (
                      <li key={v.viewer} className="flex flex-wrap justify-between gap-2 py-2">
                        <span>{who(v)}</span>
                        <span className="text-xs text-black/50">
                          {v.tapped_at ? `🔔 opened the notification ${formatDateTime(v.tapped_at)}` : `seen ${formatDateTime(v.first_seen_at)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })
        )}
      </Section>

      <Section title="Staff alerts (last 30 days)" intro="An alert counts as seen when the person opens the request it is about, or the Alerts page.">
        <div className="overflow-x-auto rounded-3xl bg-white soft-card ring-1 ring-black/5">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-black/5 bg-[#f7f9fb]">
              <tr>
                <th className={th}>Sent</th>
                <th className={th}>To</th>
                <th className={th}>Alert</th>
                <th className={th}>Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {alerts.slice(0, 100).map((a, i) => (
                <tr key={i}>
                  <td className={`${td} whitespace-nowrap text-xs`}>{formatDateTime(a.created_at)}</td>
                  <td className={`${td} text-xs font-semibold`}>{staffName.get(a.staff_id) ?? "—"}</td>
                  <td className={`${td} text-xs`}>{a.title}</td>
                  <td className={`${td} whitespace-nowrap text-xs`}>
                    {a.read_at ? <span className="text-green-700">✓ {formatDateTime(a.read_at)}</span> : <span className="font-bold text-amber-700">Not yet</span>}
                  </td>
                </tr>
              ))}
              {alerts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-black/50">
                    No alerts in the last 30 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
