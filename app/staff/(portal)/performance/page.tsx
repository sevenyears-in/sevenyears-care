import { WalkinBox } from "@/components/WalkinBox";
import { creStoreOf, loadWalkins } from "@/lib/walkins";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { attendanceCode } from "@/lib/attendance";
import { formatDate, formatDateTime, todayISO } from "@/lib/helpers";
import { dayState, hoursOf, istNow, peakLeanDays } from "@/lib/business-day";
import { merchStores } from "@/lib/merch-access";
import { loadStockState } from "@/lib/stock";
import { actionPlans, hourRange, peakLeanHours, personalPlan, planRoleOf, planView, stockPlanItems, PLAN_ROLE_LABEL, type PlanItem, type PlanRole } from "@/lib/action-plans";
import { loadFollow, type Follow } from "@/lib/plan-follow";
import { PlanFollow } from "@/components/PlanFollow";
import { loadSalaries, monthReport, personDetail, storePreviousPeriod, storeTrends, type StoreTrends, yearlyProgress, type YearlyLine, type PeriodTotals, type PersonReport, type StoreReport } from "@/lib/performance";
import { performanceAccess } from "@/lib/performance-access";
import { groupName, isMonth, monthRange, pct, rupees, type IncentiveGroup, type PerformanceSettings } from "@/lib/performance-rules";
import { nextSlab, rulesOn, type AbvRule, type AchievementRule, type IncentiveRule, type WowRule } from "@/lib/incentive-rules";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Performance" };

type Search = { m?: string; u?: string; store?: string; view?: string };

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const short = (n: number) => (Math.abs(n) >= 100000 ? `₹${(n / 100000).toFixed(n >= 1e7 ? 0 : 2)} L` : rupees(n));

function qs(base: Search, change: Partial<Search>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...change })) if (v) p.set(k, v);
  const s = p.toString();
  return `/staff/performance${s ? `?${s}` : ""}`;
}

// ------------------------------------------------------------------
// Small UI pieces
// ------------------------------------------------------------------

function Tile({ label, value, note, tone = "default" }: { label: string; value: ReactNode; note?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const ring = tone === "good" ? "ring-green-200" : tone === "warn" ? "ring-amber-200" : tone === "bad" ? "ring-red-200" : "ring-black/5";
  return (
    <div className={`rounded-2xl bg-white p-4 soft-card ring-1 ${ring}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-black/55">{note}</p>}
    </div>
  );
}

/** Today's sales so far (bills are copied from Zoho every 30 minutes). */
function TodayStrip({ day, label, needed, target }: { day: StoreReport["today"]; label: string; needed: number; target: string | null }) {
  const abv = day.bills ? day.net / day.bills : 0;
  const upb = day.bills ? day.units / day.bills : 0;
  const reached = needed > 0 ? day.net / needed : null;
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#064f5a] via-[#0a6f7f] to-[#0b7f91] p-5 text-white soft-card ring-1 ring-[#11b8d0]/40 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[10px] tracking-[0.18em] text-white">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7ff0ff] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7ff0ff]" />
              </span>
              LIVE
            </span>
            {label} · today so far
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums">{rupees(day.net)}</p>
          <p className="mt-1 text-sm text-white/80">
            {day.bills} bill(s) · ABV {day.bills ? rupees(abv) : "—"} · UPB {day.bills ? upb.toFixed(1) : "—"}
            {day.returns ? ` · returns ${rupees(day.returns)}` : ""}
          </p>
        </div>
        {needed > 0 && (
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/75">Needed today{target ? ` for ${target}` : ""}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{rupees(needed)}</p>
            <p className={`text-sm font-semibold ${reached !== null && reached >= 1 ? "text-[#b9fbc0]" : "text-[#ffe08a]"}`}>
              {reached !== null && reached >= 1 ? "✓ Done for today" : `${rupees(Math.max(0, needed - day.net))} to go`}
            </p>
          </div>
        )}
      </div>
      {needed > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
          <div className={`h-full rounded-full ${reached !== null && reached >= 1 ? "bg-[#b9fbc0]" : "bg-[#ffe08a]"}`} style={{ width: `${Math.min(100, Math.round((reached ?? 0) * 100))}%` }} />
        </div>
      )}
      <p className="mt-2 text-[11px] text-white/70">Provisional — the day is not closed yet. Bills are copied from Zoho POS every 30 minutes.</p>
    </section>
  );
}

function Panel({ title, intro, children, tone }: { title: string; intro?: ReactNode; children: ReactNode; tone?: "good" | "bad" }) {
  const bar = tone === "good" ? "bg-green-500" : tone === "bad" ? "bg-[#ff5e79]" : "bg-[#8883d7]";
  return (
    <section className="relative overflow-hidden rounded-3xl bg-white p-5 soft-card ring-1 ring-black/5 sm:p-6">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${bar}`} aria-hidden />
      <h2 className="text-lg font-bold">{title}</h2>
      {intro && <p className="mt-0.5 text-sm text-black/55">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, note, amount, muted }: { label: ReactNode; note?: ReactNode; amount: ReactNode; muted?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 border-b border-black/5 py-2.5 last:border-0 ${muted ? "text-black/40" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {note && <p className="text-xs text-black/50">{note}</p>}
      </div>
      <p className="shrink-0 text-sm font-bold tabular-nums">{amount}</p>
    </div>
  );
}

/** Progress bar with the slab marks (90, 100, 110, 120, 130%). */
function Progress({ value }: { value: number }) {
  const max = 1.4;
  const w = Math.min(value, max) / max;
  const colour = value >= 1 ? "bg-green-500" : value >= 0.9 ? "bg-amber-400" : "bg-[#ff5e79]";
  return (
    <div className="mt-3">
      <div className="relative h-4 overflow-hidden rounded-full bg-black/[0.06]">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${w * 100}%` }} />
        {[0.9, 1, 1.1, 1.2, 1.3].map((m) => (
          <span key={m} className="absolute inset-y-0 w-px bg-black/25" style={{ left: `${(m / max) * 100}%` }} aria-hidden />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] font-semibold text-black/45">
        {[0.9, 1, 1.1, 1.2, 1.3].map((m) => (
          <span key={m} className="absolute -translate-x-1/2" style={{ left: `${(m / max) * 100}%` }}>
            {Math.round(m * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums text-black/60">
              {r.note ? <span className="mr-2 text-xs text-black/40">{r.note}</span> : null}
              {rupees(r.value)}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-black/[0.05]">
            <div className="h-full rounded-full bg-[#8883d7]" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One colour per store button (brand colours). */
const STORE_COLOURS = ["#0fa8bf", "#f39237", "#ff5e79", "#5b55c9", "#2f9e44"];

const thc = "whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-black/45";
const tdc = "whitespace-nowrap px-3 py-2.5 tabular-nums";

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/staff/login");
  const sp = await searchParams;
  const thisMonth = todayISO().slice(0, 7);
  const month = isMonth(sp.m) && sp.m <= thisMonth ? sp.m : thisMonth;
  const [report, access, stockState] = await Promise.all([monthReport(month), performanceAccess(staff), loadStockState().catch(() => null)]);
  const allStores = report.stores.map((s) => s.store);
  // Stock & categories (Store Manager, ASM / Floor Manager and management).
  const stockStores = await merchStores(staff, allStores).catch(() => [] as string[]);
  const myStores = access.teamAll ? allStores : allStores.filter((s) => access.teamStores.includes(s));
  // Walk-ins: the CRE of a store posts today's running total; SM / ASM / management can correct it.
  const creStore = month === thisMonth ? await creStoreOf(staff).catch(() => null) : null;
  const walkinBox = async (store: string | null) => {
    if (!store || month !== thisMonth) return null;
    const st = report.stores.find((x) => x.store === store);
    const w = await loadWalkins(store, istNow().date).catch(() => null);
    return (
      <WalkinBox
        store={store}
        bills={st?.today.bills ?? 0}
        count={w?.count ?? null}
        updatedBy={w?.updated_by_name ?? null}
        updatedAt={w?.updated_at ?? null}
        canEdit={creStore === store || stockStores.includes(store)}
      />
    );
  };
  // Only people in an incentive group have their own page; managers see their stores.
  if (!access.eligible && !access.teamAll && !access.teamStores.length && !creStore) redirect("/staff");
  const base: Search = { m: month !== thisMonth ? month : undefined };
  const labels = report.settings.groupLabels;

  const me = attendanceCode(staff.userId);
  const wanted = sp.u && myStores.length ? attendanceCode(sp.u) : me;
  const view = myStores.length && (sp.view === "team" || (!access.eligible && !sp.u)) ? "team" : "person";
  const teamStore = view === "team" ? (myStores.includes((sp.store ?? "").toUpperCase()) ? (sp.store ?? "").toUpperCase() : myStores[0]) : null;

  let found: { person: PersonReport; store: StoreReport } | null = null;
  for (const s of report.stores) {
    const p = s.people.find((x) => x.userId === wanted);
    if (p && (wanted === me || myStores.includes(s.store))) {
      found = { person: p, store: s };
      break;
    }
  }

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">My Performance</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
          {view === "team" ? teamStore : found && wanted !== me ? found.person.name : "My Performance"}
        </h1>
        <p className="mt-1 text-sm text-black/55">
          {monthLabel(month)} · Bills up to {report.lastBillDate ? formatDate(report.lastBillDate) : "—"}
          {report.settings.lastSyncAt ? ` · updated ${formatDateTime(report.settings.lastSyncAt)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ ...sp, ...base }, { m: shiftMonth(month, -1) })} className="rounded-full bg-white px-3 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
          ← {monthLabel(shiftMonth(month, -1)).split(" ")[0]}
        </Link>
        {month < thisMonth && (
          <Link href={qs({ ...sp }, { m: shiftMonth(month, 1) === thisMonth ? undefined : shiftMonth(month, 1) })} className="rounded-full bg-white px-3 py-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-black/5">
            {monthLabel(shiftMonth(month, 1)).split(" ")[0]} →
          </Link>
        )}
      </div>
    </div>
  );

  const switcher = myStores.length ? (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 soft-card ring-1 ring-black/5">
      {access.eligible && (
        <Link href={qs(base, {})} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${view === "person" && wanted === me ? "bg-[#8883d7] text-white" : "hover:bg-black/5"}`}>
          Me
        </Link>
      )}
      {myStores.map((s, i) => {
        const c = STORE_COLOURS[i % STORE_COLOURS.length];
        const on = teamStore === s;
        return (
          <Link
            key={s}
            href={qs(base, { view: "team", store: s })}
            className="rounded-full px-4 py-1.5 text-sm font-bold ring-1 transition hover:opacity-90"
            style={on ? { background: c, color: "#fff", boxShadow: `0 0 0 1px ${c}` } : { background: `${c}1a`, color: c, boxShadow: `0 0 0 1px ${c}55` }}
          >
            {s}
          </Link>
        );
      })}
      {isAdmin(staff.role) && (
        <Link href="/staff/admin/performance" className="ml-auto rounded-full px-3 py-1.5 text-sm font-semibold text-[#8883d7] hover:bg-black/5">
          🎯 Targets &amp; settings
        </Link>
      )}
    </div>
  ) : null;

  const stockBar = (store: string | null) => {
    if (!store || !stockStores.includes(store)) return null;
    const a = stockState?.alerts?.[store];
    return (
      <div className="flex flex-wrap items-stretch gap-3">
        {a && a.low > 0 && (
          <Link
            href={`/staff/performance/stock?store=${encodeURIComponent(store)}&show=low`}
            className="flex flex-1 items-center justify-between gap-3 rounded-2xl bg-[#d6224a] px-5 py-3 text-white shadow-md transition hover:opacity-95"
          >
            <span className="text-sm font-bold">⚠ {a.low} fast-moving item(s) at {store} are running low{a.out ? ` · ${a.out} out of stock` : ""}</span>
            <span className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-bold">View items →</span>
          </Link>
        )}
        <Link
          href={`/staff/performance/stock?store=${encodeURIComponent(store)}`}
          className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[#5b55c9] soft-card ring-1 ring-black/5 hover:bg-black/[0.02]"
        >
          📦 Stock &amp; categories →
        </Link>
        <Link
          href={`/staff/performance/daily?store=${encodeURIComponent(store)}`}
          className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[#5b55c9] soft-card ring-1 ring-black/5 hover:bg-black/[0.02]"
        >
          📅 Day-wise sales →
        </Link>
        <Link
          href={`/staff/performance/reports?store=${encodeURIComponent(store)}`}
          className="flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-[#5b55c9] soft-card ring-1 ring-black/5 hover:bg-black/[0.02]"
        >
          🧾 End-of-day reports →
        </Link>
      </div>
    );
  };

  if (!report.stores.length || report.lastBillDate === null) {
    return (
      <div className="space-y-6">
        {header}
        {switcher}
        <Panel title="No sales copied yet">
          <p className="text-sm text-black/60">
            Bills for {monthLabel(month)} have not been copied from Zoho POS yet.
            {isAdmin(staff.role) ? " Open Targets & settings and press “Copy bills from Zoho”." : " Please check again later."}
          </p>
        </Panel>
      </div>
    );
  }

  if (view === "team" && teamStore) {
    const store = report.stores.find((s) => s.store === teamStore)!;
    // Salary-based view is for management only (not the Store Manager).
    const management = isAdmin(staff.role) || staff.role === "director";
    const [prev, salaries, trends, fl] = await Promise.all([
      storePreviousPeriod(month, store.store, store.daysGone).catch(() => null),
      management ? loadSalaries().catch(() => null) : Promise.resolve(null),
      storeTrends(month, store.store).catch(() => null),
      loadFollow(store.store, month, shiftMonth(month, -1)).catch(() => null),
    ]);
    // Follow-up of plan points: Store Manager / ASM / Floor Manager of the store and management.
    const follow: FollowCtx | null = fl
      ? { store: store.store, month, now: Object.fromEntries(fl.now), before: Object.fromEntries(fl.before), canEdit: stockStores.includes(store.store) }
      : null;
    return (
      <div className="space-y-6">
        {header}
        {switcher}
        {stockBar(store.store)}
        {await walkinBox(store.store)}
        <TeamView
          store={store}
          base={base}
          threshold={report.settings.highDiscountPct}
          canExport={isAdmin(staff.role)}
          labels={labels}
          prev={prev}
          salaries={salaries ? Object.fromEntries(salaries) : null}
          salesPerSalary={report.settings.salesPerSalary}
          trends={trends}
          asmIsFm={report.settings.asmIsFm}
          rules={report.settings}
          lastSyncAt={report.settings.lastSyncAt ?? null}
          follow={follow}
          stockAlert={stockState?.alerts?.[store.store] ?? null}
        />
      </div>
    );
  }

  if (!found) {
    return (
      <div className="space-y-6">
        {header}
        {switcher}
        {await walkinBox(creStore)}
        <Panel title="No sales found for you this month">
          <p className="text-sm text-black/60">
            Sales are matched by your User ID ({staff.userId}) as the salesperson on the Zoho POS bill (for example “{staff.userId} - {staff.fullName.split(" ")[0]?.toUpperCase()}”).
            If you billed under another name, ask the admin to link it.
          </p>
        </Panel>
      </div>
    );
  }

  const [detail, yearly, myTrends] = await Promise.all([
    personDetail(month, found.person.userId, report.settings.highDiscountPct / 100, report.rules),
    yearlyProgress(found.person.userId, found.person.group, todayISO()).catch(() => [] as YearlyLine[]),
    storeTrends(month, found.store.store).catch(() => null),
  ]);
  const asmIsFm = report.settings.asmIsFm;
  const planRole: PlanRole = planRoleOf("", found.person.roleLabel, found.person.group, asmIsFm);
  const myPlan = myTrends ? personalPlan(planRole, found.store, myTrends, found.person, asmIsFm) : [];
  return (
    <div className="space-y-6">
      {header}
      {switcher}
      {wanted === me && stockBar(found.store.store)}
      {wanted === me && creStore ? await walkinBox(creStore) : null}
      <PersonView p={found.person} store={found.store} detail={detail} threshold={report.settings.highDiscountPct} rules={report.rules} labels={labels} />
      <PeakLean
        title="Your peak and lean times"
        intro="This month. Green = when you sell most, red = when you sell least."
        hours={detail.hours}
        timed={detail.timedBills}
        total={found.person.bills}
        days={detail.daily}
        store={found.store.store}
        rules={report.settings}
        lastSyncAt={report.settings.lastSyncAt ?? null}
      />
      {myPlan.length > 0 && (
        <Panel title={`Action plan — ${planRole === "asm" && asmIsFm ? "ASM / Floor Manager" : PLAN_ROLE_LABEL[planRole]}`} intro="From the store's sales trend and your own numbers. Do the red ones first.">
          <PlanList items={myPlan} role={planRole} />
        </Panel>
      )}
      {yearly.length > 0 && (
        <Panel title={`Yearly incentives — financial year ${yearly[0].fy}`} intro="April to March. Worked out on the whole year's sales and targets, paid after March.">
          {yearly.map((y) => (
            <div key={y.name} className="border-b border-black/5 py-3 last:border-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{y.name}</p>
                  <p className="text-xs text-black/55">
                    {rupees(y.net)} sold this year
                    {y.target ? ` of ${rupees(y.target)} target (${pct(y.achievement ?? 0)})` : " · no targets set for this year yet"}
                    {y.next && y.target ? ` · ${rupees(Math.max(0, y.next.from * y.target - y.net))} more for ${rupees(y.next.amount)}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums">{rupees(y.amount)}</p>
              </div>
              {y.target ? <Progress value={y.achievement ?? 0} /> : null}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// One person
// ------------------------------------------------------------------

function PersonView({
  p,
  store,
  detail,
  threshold,
  rules,
  labels,
}: {
  p: PersonReport;
  store: StoreReport;
  detail: Awaited<ReturnType<typeof personDetail>>;
  threshold: number;
  rules: IncentiveRule[];
  labels: Partial<Record<IncentiveGroup, string>>;
}) {
  const { days, to: monthEnd } = monthRange(store.month);
  const daysLeft = Math.max(0, days - store.daysGone);
  const running = daysLeft > 0;
  const inForceAtEnd = rulesOn(rules, monthEnd);
  const achRule = inForceAtEnd.find((r): r is AchievementRule => r.kind === "achievement" && r.groups.includes(p.group));
  const abvRule = inForceAtEnd.find((r): r is AbvRule => r.kind === "abv" && r.groups.includes(p.group));
  const wowRule = inForceAtEnd.find((r): r is WowRule => r.kind === "wow" && r.groups.includes(p.group));
  const next = p.achievement !== null && achRule ? nextSlab(achRule.slabs, p.achievement) : null;
  // Store Manager: measured on the store (store sales against the store target).
  const heroNet = p.targetApplies ? p.net : store.net;
  // Store Manager: the store's figures are their figures.
  const m = measureOf(p, store);
  const neededForNext = next && p.target ? Math.max(0, next.from * p.target - heroNet) : 0;
  const perDay = running && neededForNext ? neededForNext / daysLeft : 0;
  const team = store.people.filter((x) => x.group === p.group && x.bills > 0);
  const rank = [...team].sort((a, b) => b.net - a.net).findIndex((x) => x.userId === p.userId) + 1;
  const teamAbv = team.length ? team.reduce((s, x) => s + x.net, 0) / Math.max(1, team.reduce((s, x) => s + x.bills, 0)) : 0;
  const teamDisc = team.reduce((s, x) => s + x.gross, 0) ? team.reduce((s, x) => s + x.discount, 0) / team.reduce((s, x) => s + x.gross, 0) : 0;
  const itemsPerBill = p.bills ? p.units / p.bills : 0;
  const teamIpb = team.reduce((s, x) => s + x.bills, 0) ? team.reduce((s, x) => s + x.units, 0) / team.reduce((s, x) => s + x.bills, 0) : 0;
  const abvNext = abvRule ? [...abvRule.slabs].sort((a, b) => a.abv - b.abv).find((s) => p.abv < s.abv) : null;
  const att = p.attendance;
  const share = att.found ? att.share : 1;

  // Lost incentives
  const lost: { label: string; note: string; amount: number | null }[] = [];
  if (p.returns > 0) lost.push({ label: `Returns took away ${rupees(p.returns)} of sales`, note: `${p.returnCount} return(s) against your bills this month`, amount: null });
  for (const note of p.lostNotes) lost.push({ label: "Incentive lost on returned bills", note, amount: null });
  if (p.lostToReturns > 0) lost.push({ label: "Total lost on returned bills", note: "Returned bills do not earn per-bill incentives", amount: p.lostToReturns });
  if (p.attendanceCut > 0) lost.push({ label: "Cut for attendance", note: `${att.absences} duty short of ${att.required} → ${pct(att.share)} paid`, amount: p.attendanceCut });
  for (const m of detail.nearMisses)
    lost.push({
      label: `${m.bills.length} bill(s) just missed “${m.name}”`,
      note: `Each would have earned ${rupees(m.amount)}: ${m.bills.slice(0, 4).map((b) => `${b.invoice_number} (${b.gap})`).join(", ")}`,
      amount: m.bills.length * m.amount,
    });
  if (achRule && p.achievement !== null && !running && !p.lines.some((l) => l.ruleId === achRule.id && l.amount > 0)) {
    const first = nextSlab(achRule.slabs, -1);
    if (first) lost.push({ label: `${achRule.name} not reached`, note: `${pct(p.achievement)} of target; ${Math.round(first.from * 100)}% earns ${rupees(first.amount)}`, amount: first.amount });
  }
  if (!store.poolRate && !running && store.poolName) lost.push({ label: "Store pool not reached", note: `${store.store} reached ${pct(store.achievement)} of target`, amount: null });

  // Insights
  const tips: string[] = [];
  if (running && p.target && neededForNext > 0 && next)
    tips.push(`Sell ${rupees(perDay)} a day for the next ${daysLeft} day(s) to reach ${Math.round(next.from * 100)}% and earn ₹${next.amount.toLocaleString("en-IN")}.`);
  if (!p.target && (achRule || abvRule)) tips.push("No individual target is set for you this month yet — the target and ABV bonuses start once it is set.");
  if (abvNext && p.bills) tips.push(`Your ABV is ${rupees(p.abv)}. ${rupees(abvNext.abv - p.abv)} more per bill reaches the ₹${abvNext.abv.toLocaleString("en-IN")} ABV level (₹${abvNext.amount.toLocaleString("en-IN")} with the matching target %).`);
  if (teamAbv && p.bills) tips.push(`${p.abv >= teamAbv ? "Above" : "Below"} the team ABV of ${rupees(teamAbv)}. You sell ${itemsPerBill.toFixed(1)} items per bill (team ${teamIpb.toFixed(1)}) — one more add-on per bill lifts ABV.`);
  if (p.discountPct > teamDisc * 1.5 && p.discountPct > 0.01) tips.push(`Your discount (${pct(p.discountPct, 1)}) is higher than the team (${pct(teamDisc, 1)}). Every ₹100 discount is ₹100 less in your sales.`);
  if (detail.categories.length >= 2)
    tips.push(
      `Most of your sales come from ${detail.categories[0].name}${detail.categories[1] ? ` and ${detail.categories[1].name}` : ""}. Suggest items from other categories${wowRule ? ` to make WOW bills (${rupees(wowRule.amount)} each)` : ""}.`
    );
  if (rank && team.length > 1) tips.push(`You are #${rank} of ${team.length} in ${groupName(p.group, labels)} at ${store.store}.`);
  if (store.nextSlab && running) tips.push(`The store needs ${short(store.nextSlab.needed)} more to reach ${Math.round(store.nextSlab.from * 100)}% — that raises everyone’s pool.`);
  if (att.found && att.remaining > 0) tips.push(`Duties: ${att.duties} so far${att.noData ? ` (+${att.noData} day(s) with no punching data, counted as present)` : ""}, ${att.required} needed — ${Math.max(0, att.required - att.duties - att.noData)} more in the ${att.remaining} day(s) left.`);

  const best = [...detail.daily].sort((a, b) => b.net - a.net)[0];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="brand-wash soft-card relative overflow-hidden rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-black/55">
              {p.name} · {p.isPt ? p.userId : p.roleLabel} · {store.store} · {groupName(p.group, labels)}
            </p>
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-black/45">
              {p.targetApplies ? "Net sales" : `${store.store} store net sales`} (after discounts &amp; returns, with GST)
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl">{rupees(heroNet)}</p>
            {!p.targetApplies && (
              <p className="text-xs text-black/50">
                {p.poolOnly ? `No sales target — you share the ${store.store} store pool.` : `Your target is the store target. Your own billing: ${rupees(p.net)}.`}
              </p>
            )}
            <p className="mt-1 text-sm text-black/55">
              {p.target ? (
                <>
                  Target {rupees(p.target)} · <b className="text-black">{pct(p.achievement ?? 0)}</b> achieved
                </>
              ) : p.poolOnly ? (
                "No sales target · store pool share"
              ) : (
                "No individual target set for this month"
              )}
            </p>
          </div>
          <div className="rounded-2xl bg-white/80 px-5 py-4 text-right ring-1 ring-black/5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">{running ? "Incentive so far (estimate)" : "Incentive (estimate)"}</p>
            <p className="mt-1 text-3xl font-bold text-green-700 tabular-nums">{rupees(p.total)}</p>
            {p.attendanceCut > 0 && <p className="text-xs text-[#ff5e79]">after {rupees(p.attendanceCut)} attendance cut</p>}
          </div>
        </div>
        {p.target ? <Progress value={p.achievement ?? 0} /> : null}
        {running && next && p.target ? (
          <p className="mt-2 text-sm">
            🎯 <b>{rupees(neededForNext)}</b> more to reach {Math.round(next.from * 100)}% (₹{next.amount.toLocaleString("en-IN")} bonus) — about <b>{rupees(perDay)}</b> a day for {daysLeft} day(s).
          </p>
        ) : null}
      </section>

      {store.month === todayISO().slice(0, 7) && (
        <TodayStrip
          day={m.isStore ? store.today : p.today}
          label={m.isStore ? `${store.store} store` : p.name.split(" ").slice(0, 2).join(" ")}
          // Today's share of what is left: (target − sold before today) ÷ days left including today.
          needed={p.target ? Math.max(0, (p.target - (heroNet - (m.isStore ? store.today.net : p.today.net))) / Math.max(1, daysLeft + 1)) : 0}
          target={p.target ? "target" : null}
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={m.isStore ? "Store bills" : "Bills"} value={m.bills} note={`${m.units} items · ${m.bills ? (m.units / m.bills).toFixed(1) : "0"} per bill (UPB)`} />
        <Tile
          label={m.isStore ? "Store avg bill (ABV)" : "Avg bill (ABV)"}
          value={rupees(m.abv)}
          note={p.abvTarget ? `Target ${rupees(p.abvTarget)}` : m.isStore ? `Own billing ${p.bills} bill(s)` : `Team ${rupees(teamAbv)}`}
          tone={!m.isStore && teamAbv && p.abv >= teamAbv ? "good" : "default"}
        />
        <Tile label="Discount given" value={rupees(p.discount)} note={`${pct(p.discountPct, 1)} of sales · ${p.flaggedBills} bill(s) over ${threshold}%`} tone={p.flaggedBills ? "warn" : "default"} />
        <Tile label="Returns" value={rupees(p.returns)} note={`${p.returnCount} return(s)`} tone={p.returns ? "bad" : "default"} />
        <Link href={`/staff/performance/duties?u=${encodeURIComponent(p.userId)}&m=${store.month}`} className="block rounded-2xl transition hover:-translate-y-0.5">
        <Tile
          label="Duties ›"
          value={att.found ? `${att.duties + att.noData}/${att.required}` : "—"}
          note={
            att.found
              ? `${att.absences ? `${att.absences} short → ${pct(att.share)} paid` : att.noData ? `incl. ${att.noData} day(s) without punching data` : "On track"}${att.late ? ` · ${att.late} late` : ""}`
              : "No attendance found"
          }
          tone={att.absences ? "bad" : att.late ? "warn" : "default"}
        />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Incentives earned" intro="Estimate from today's bills. The final payout is checked by management." tone="good">
          {store.poolName && (
            <Row
              label={store.poolName}
              note={
                store.poolRate
                  ? `${store.store} at ${pct(store.achievement)} → pool ${pct(store.poolRate, 1)} of sales (${rupees(store.pool)})`
                  : `${store.store} at ${pct(store.achievement)} of ${short(store.target)}${store.nextSlab ? ` — pool starts at ${Math.round(store.nextSlab.from * 100)}%` : ""}`
              }
              amount={rupees(p.storeShare)}
              muted={!p.storeShare}
            />
          )}
          {p.lines.map((l) => (
            <Row key={l.ruleId} label={l.name} note={l.note} amount={rupees(l.amount)} muted={!l.amount} />
          ))}
          {share < 1 && <Row label="Attendance" note={`${pct(share)} payable`} amount={`− ${rupees(p.attendanceCut)}`} />}
          <div className="mt-2 flex items-center justify-between rounded-xl bg-green-50 px-3 py-2.5">
            <span className="text-sm font-bold text-green-800">Total</span>
            <span className="text-lg font-bold text-green-800 tabular-nums">{rupees(p.total)}</span>
          </div>
        </Panel>

        <Panel title="Incentives lost or missed" intro="Where money slipped away this month — and what is still within reach." tone="bad">
          {lost.length ? (
            lost.map((l) => <Row key={l.label} label={l.label} note={l.note} amount={l.amount === null ? "—" : rupees(l.amount)} />)
          ) : (
            <p className="text-sm text-black/55">Nothing lost so far. 👏</p>
          )}
        </Panel>
      </div>

      {tips.length > 0 && (
        <Panel title="Insights">
          <ul className="space-y-2 text-sm">
            {tips.map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden>💡</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="What you sold — by category">
          {detail.categories.length ? <Bars rows={detail.categories.slice(0, 10).map((c) => ({ label: c.name, value: c.net, note: `${c.units} pcs` }))} /> : <p className="text-sm text-black/55">No items yet.</p>}
        </Panel>
        <Panel title="Top items">
          {detail.items.length ? (
            <ol className="space-y-1.5 text-sm">
              {detail.items.slice(0, 12).map((i, k) => (
                <li key={i.name} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="mr-2 text-black/35">{k + 1}.</span>
                    {i.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-black/60">
                    {i.units} pcs · {rupees(i.net)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-black/55">No items yet.</p>
          )}
        </Panel>
      </div>

      {detail.daily.length > 0 && (
        <Panel title="Day by day" intro={best ? `Best day: ${formatDate(best.date)} — ${rupees(best.net)} from ${best.bills} bill(s)` : undefined}>
          <div className="flex h-32 items-end gap-1">
            {detail.daily.map((d) => {
              const max = Math.max(...detail.daily.map((x) => x.net), 1);
              return (
                <div key={d.date} className="group relative flex-1">
                  <div className="rounded-t bg-[#8883d7]/80 group-hover:bg-[#8883d7]" style={{ height: `${Math.max(3, (d.net / max) * 120)}px` }} title={`${formatDate(d.date)}: ${rupees(d.net)} · ${d.bills} bills`} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-black/40">
            <span>{formatDate(detail.daily[0].date)}</span>
            <span>{formatDate(detail.daily[detail.daily.length - 1].date)}</span>
          </div>
        </Panel>
      )}

      <Panel title={`High discounts (over ${threshold}% of the bill)`} intro="Bills where the discount was more than the allowed limit." tone={detail.flagged.length ? "bad" : undefined}>
        {detail.flagged.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className={thc}>Bill</th>
                  <th className={thc}>Date</th>
                  <th className={`${thc} text-right`}>Before discount</th>
                  <th className={`${thc} text-right`}>Discount</th>
                  <th className={`${thc} text-right`}>%</th>
                </tr>
              </thead>
              <tbody>
                {detail.flagged.slice(0, 50).map((b) => (
                  <tr key={b.invoice_id} className="border-t border-black/5">
                    <td className={`${tdc} font-semibold`}>{b.invoice_number}</td>
                    <td className={tdc}>{formatDate(b.invoice_date)}</td>
                    <td className={`${tdc} text-right`}>{rupees(b.gross)}</td>
                    <td className={`${tdc} text-right`}>{rupees(b.discount)}</td>
                    <td className={`${tdc} text-right font-bold text-[#d6224a]`}>{pct(b.pct, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-black/55">No bill above {threshold}% discount. 👍</p>
        )}
      </Panel>

      {detail.returned.length > 0 && (
        <Panel title="Returns against your bills">
          <div className="-mx-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className={thc}>Return</th>
                  <th className={thc}>Date</th>
                  <th className={thc}>Original bill</th>
                  <th className={`${thc} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {detail.returned.map((r) => (
                  <tr key={r.creditnote_id} className="border-t border-black/5">
                    <td className={`${tdc} font-semibold`}>{r.creditnote_number}</td>
                    <td className={tdc}>{formatDate(r.return_date)}</td>
                    <td className={tdc}>{r.invoice_number ?? "—"}</td>
                    <td className={`${tdc} text-right`}>{rupees(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Store team
// ------------------------------------------------------------------

function TeamView({
  store,
  base,
  threshold,
  canExport,
  labels,
  prev,
  salaries,
  salesPerSalary,
  trends,
  asmIsFm,
  rules,
  lastSyncAt,
  follow,
  stockAlert,
}: {
  follow: FollowCtx | null;
  stockAlert: { low: number; out: number } | null;
  rules: Pick<PerformanceSettings, "storeHours" | "specialDays" | "leanBelowPct" | "shortDayPct">;
  lastSyncAt: string | null;
  store: StoreReport;
  base: Search;
  threshold: number;
  canExport: boolean;
  labels: Partial<Record<IncentiveGroup, string>>;
  prev: PeriodTotals | null;
  salaries: Record<string, number> | null;
  salesPerSalary: number;
  trends: StoreTrends | null;
  asmIsFm: boolean;
}) {
  const worth = salaries ? worthOf(store, salaries, salesPerSalary) : null;
  const dutiesHref = (id: string) => `/staff/performance/duties?u=${encodeURIComponent(id)}&m=${store.month}`;
  const totals = store.people.reduce(
    (t, p) => ({ share: t.share + p.storeShare, bonus: t.bonus + p.bonus, spot: t.spot + p.spotTotal, total: t.total + p.total }),
    { share: 0, bonus: 0, spot: 0, total: 0 }
  );
  const running = store.daysGone < store.daysInMonth;
  const perDay = store.nextSlab && running ? store.nextSlab.needed / Math.max(1, store.daysInMonth - store.daysGone) : 0;
  return (
    <div className="space-y-6">
      <section className="brand-wash soft-card relative overflow-hidden rounded-3xl bg-white p-5 ring-1 ring-black/5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/45">Store net sales (after discounts &amp; returns, with GST)</p>
            <p className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl">{short(store.net)}</p>
            <p className="mt-1 text-sm text-black/55">
              Target {short(store.target)} · <b className="text-black">{pct(store.achievement)}</b> · {store.bills} bills · discounts {short(store.discount)}
            </p>
            <p className="mt-0.5 text-xs text-black/50">
              Billed {short(store.invoiceNet)} (the sales figure in Zoho POS) − returns {short(store.returns)} ({store.returnCount}) = net {short(store.net)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/80 px-5 py-4 text-right ring-1 ring-black/5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-black/45">Store incentive pool</p>
            <p className="mt-1 text-3xl font-bold text-green-700 tabular-nums">{rupees(store.pool)}</p>
            <p className="text-xs text-black/50">{store.poolRate ? `${pct(store.poolRate, 1)} of sales` : store.nextSlab ? `Starts at ${Math.round(store.nextSlab.from * 100)}% of target` : "No store pool in force"}</p>
          </div>
        </div>
        <Progress value={store.achievement} />
        {store.nextSlab && running && (
          <p className="mt-2 text-sm">
            🎯 <b>{short(store.nextSlab.needed)}</b> more to reach {Math.round(store.nextSlab.from * 100)}% (pool {pct(store.nextSlab.rate, 1)}) — about <b>{rupees(perDay)}</b> a day.
          </p>
        )}
        {store.othersBills > 0 && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ⚑ <b>Others:</b> {store.othersBills} bill(s) worth {short(store.othersNet)} have no salesperson on the bill. They count for the store but for nobody&apos;s
            sales — the Store Manager should bring this down.
          </p>
        )}
      </section>

      <StoreDashboard store={store} prev={prev} threshold={threshold} labels={labels} trends={trends} />

      {trends && (
        <PeakLean
          title="Peak and lean times — store"
          intro="Last 28 days. Green = peak, red = lean. Put the strongest team on the floor in the green hours and days."
          hours={trends.hours}
          timed={trends.timedBills}
          total={trends.totalBills}
          days={trends.daily}
          store={store.store}
          rules={rules}
          lastSyncAt={lastSyncAt}
        />
      )}

      {trends && (
        <ActionPlans
          plans={actionPlans(store, trends, prev, asmIsFm).map((pl) => (pl.role === "sm" ? { ...pl, items: [...stockPlanItems(stockAlert), ...pl.items] } : pl))}
          follow={follow}
        />
      )}


      <Panel
        title="Team"
        intro="Tap a name to see that person's page. Incentives are estimates until the month is checked."
      >
        <div className="-mx-2 overflow-x-auto">
          <table className="min-w-[1100px] text-sm">
            <thead>
              <tr>
                <th className={thc}>Name</th>
                <th className={thc}>Group</th>
                <th className={`${thc} text-right`}>Net sales</th>
                <th className={`${thc} text-right`}>Target</th>
                <th className={`${thc} text-right`}>Ach.</th>
                <th className={`${thc} text-right`}>Bills</th>
                <th className={`${thc} text-right`}>ABV</th>
                <th className={`${thc} text-right`}>UPB</th>
                <th className={`${thc} text-right`}>Disc.</th>
                <th className={`${thc} text-right`}>Returns</th>
                <th className={`${thc} text-right`}>Duties</th>
                <th className={`${thc} text-right`}>Store share</th>
                <th className={`${thc} text-right`}>Bonus</th>
                <th className={`${thc} text-right`}>Spot</th>
                <th className={`${thc} text-right`}>Total</th>
                {worth && (
                  <>
                    <th className={`${thc} border-l border-black/10 text-right`}>Salary</th>
                    <th className={`${thc} text-right`}>Sales per ₹1</th>
                    <th className={thc}>Worth</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {store.people.map((p) => {
                const m = measureOf(p, store);
                return (
                <tr key={p.userId} className="border-t border-black/5 hover:bg-black/[0.02]">
                  <td className={tdc}>
                    <Link href={qs(base, { u: p.userId })} className="font-semibold text-[#5b55c9] hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-1.5 text-xs text-black/40">{p.userId}</span>
                  </td>
                  <td className={`${tdc} text-black/60`}>{groupName(p.group, labels)}</td>
                  <td className={`${tdc} text-right font-semibold`} title={m.isStore ? `Measured on the store. Own billing: ${rupees(p.net)} from ${p.bills} bill(s)` : undefined}>
                    {rupees(m.net)}
                    {m.isStore && <span className="ml-1 rounded-full bg-[#8883d7]/15 px-1.5 text-[10px] font-bold text-[#5b55c9]">store</span>}
                  </td>
                  <td className={`${tdc} text-right text-black/60`}>{p.target ? rupees(p.target) : p.targetApplies ? "—" : <span className="text-xs">{p.poolOnly ? "No target" : "Store target"}</span>}</td>
                  <td className={`${tdc} text-right font-semibold ${p.achievement === null ? "text-black/30" : p.achievement >= 1 ? "text-green-700" : p.achievement >= 0.9 ? "text-amber-600" : "text-[#d6224a]"}`}>
                    {p.achievement === null ? "—" : pct(p.achievement)}
                  </td>
                  <td className={`${tdc} text-right`}>{m.bills}</td>
                  <td className={`${tdc} text-right`}>{m.bills ? rupees(m.abv) : "—"}</td>
                  <td className={`${tdc} text-right`}>{m.bills ? (m.units / m.bills).toFixed(1) : "—"}</td>
                  <td className={`${tdc} text-right ${p.flaggedBills ? "font-semibold text-[#d6224a]" : ""}`}>
                    {pct(p.discountPct, 1)}
                    {p.flaggedBills ? <span className="ml-1 text-xs">⚑{p.flaggedBills}</span> : null}
                  </td>
                  <td className={`${tdc} text-right`}>{p.returns ? rupees(p.returns) : "—"}</td>
                  <td className={`${tdc} text-right ${p.attendance.absences ? "font-semibold text-[#d6224a]" : ""}`}><Link href={dutiesHref(p.userId)} className="underline decoration-dotted underline-offset-2 hover:text-[#5b55c9]">
                      {p.attendance.found || p.attendance.justified ? `${p.attendance.duties + p.attendance.noData}/${p.attendance.required}` : "—"}
                    </Link>
                    {p.attendance.late ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800" title={`${p.attendance.lateMinutes} min late in all`}>{p.attendance.late} late</span> : null}</td>
                  <td className={`${tdc} text-right`}>{rupees(p.storeShare)}</td>
                  <td className={`${tdc} text-right`}>{rupees(p.bonus)}</td>
                  <td className={`${tdc} text-right`}>{rupees(p.spotTotal)}</td>
                  <td className={`${tdc} text-right font-bold text-green-700`}>{rupees(p.total)}</td>
                  {worth && (
                    <>
                      <td className={`${tdc} border-l border-black/10 text-right`}>{worth.map.get(p.userId)?.salary ? rupees(worth.map.get(p.userId)!.salary) : "—"}</td>
                      <td className={`${tdc} text-right font-semibold`}>{worth.map.get(p.userId)?.ratio ? rupees(worth.map.get(p.userId)!.ratio!) : "—"}</td>
                      <td className={`${tdc} ${worth.map.get(p.userId)?.verdict.cls ?? ""}`}>{worth.map.get(p.userId)?.verdict.text ?? "—"}</td>
                    </>
                  )}
                </tr>
                );
              })}
              {store.othersBills > 0 && (
                <tr className="border-t border-black/5 bg-red-50/60 text-[#b4233f]">
                  <td className={tdc}>
                    <span className="font-semibold">Others</span>
                    <span className="ml-1.5 text-xs">⚑ no salesperson on the bill</span>
                  </td>
                  <td className={`${tdc} text-xs`}>Store Manager to reduce</td>
                  <td className={`${tdc} text-right font-semibold`}>{rupees(store.othersNet)}</td>
                  <td className={`${tdc} text-right`}>—</td>
                  <td className={`${tdc} text-right`}>—</td>
                  <td className={`${tdc} text-right`}>{store.othersBills}</td>
                  <td className={`${tdc} text-right`}>{rupees(store.othersNet / store.othersBills)}</td>
                  <td className={`${tdc} text-right`}>—</td>
                  <td className={`${tdc} text-right`}>
                    {pct(store.othersGross ? store.othersDiscount / store.othersGross : 0, 1)}
                    {store.othersFlagged ? <span className="ml-1 text-xs">⚑{store.othersFlagged}</span> : null}
                  </td>
                  <td className={`${tdc} text-right`} colSpan={worth ? 9 : 6}>
                    {pct(store.net > 0 ? store.othersNet / store.invoiceNet : 0, 1)} of store sales
                  </td>
                </tr>
              )}
              <tr className="border-t-2 border-black/10 font-bold">
                <td className={tdc} colSpan={11}>
                  Total
                </td>
                <td className={`${tdc} text-right`}>{rupees(totals.share)}</td>
                <td className={`${tdc} text-right`}>{rupees(totals.bonus)}</td>
                <td className={`${tdc} text-right`}>{rupees(totals.spot)}</td>
                <td className={`${tdc} text-right text-green-700`}>{rupees(totals.total)}</td>
                {worth && <td className={tdc} colSpan={3} />}
              </tr>
            </tbody>
          </table>
        </div>
        {worth && (
          <div className="mt-4 rounded-2xl bg-[#8883d7]/[0.06] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-black/50">Staff worth — sales against salary (only management sees this)</p>
            <ul className="mt-2 space-y-1 text-sm">
              {worth.tips.map((t) => (
                <li key={t} className="flex gap-2">
                  <span aria-hidden>📌</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {canExport && (
          <a href={`/api/staff/performance/export?m=${store.month}&store=${encodeURIComponent(store.store)}`} className="mt-4 inline-block rounded-full bg-[#8883d7] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            ⬇ Download payout sheet (Excel / CSV)
          </a>
        )}
      </Panel>

      <Panel title={`High-discount bills (over ${threshold}%)`} intro={`${store.flagged.length} bill(s) this month.`} tone={store.flagged.length ? "bad" : undefined}>
        {store.flagged.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className={thc}>Bill</th>
                  <th className={thc}>Date</th>
                  <th className={thc}>Salesperson</th>
                  <th className={`${thc} text-right`}>Before discount</th>
                  <th className={`${thc} text-right`}>Discount</th>
                  <th className={`${thc} text-right`}>%</th>
                </tr>
              </thead>
              <tbody>
                {store.flagged.slice(0, 100).map((b) => (
                  <tr key={b.invoice_id} className="border-t border-black/5">
                    <td className={`${tdc} font-semibold`}>{b.invoice_number}</td>
                    <td className={tdc}>{formatDate(b.invoice_date)}</td>
                    <td className={tdc}>{b.salesperson || <span className="text-black/35">No salesperson</span>}</td>
                    <td className={`${tdc} text-right`}>{rupees(b.gross)}</td>
                    <td className={`${tdc} text-right`}>{rupees(b.discount)}</td>
                    <td className={`${tdc} text-right font-bold text-[#d6224a]`}>{pct(b.gross ? b.discount / b.gross : 0, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-black/55">No bill above {threshold}% discount. 👍</p>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------
// Store dashboard (like a person's page, for the Store Manager)
// ------------------------------------------------------------------

const change = (now: number, before: number) => (before > 0 ? (now - before) / before : null);
function Delta({ now, before, money = false, digits = 0 }: { now: number; before: number | null | undefined; money?: boolean; digits?: number }) {
  if (before === null || before === undefined || before <= 0) return null;
  const c = change(now, before)!;
  const up = c >= 0;
  return (
    <span className={`font-semibold ${up ? "text-green-700" : "text-[#d6224a]"}`}>
      {up ? "▲" : "▼"} {Math.abs(c * 100).toFixed(0)}% vs last month ({money ? rupees(before) : before.toFixed(digits)})
    </span>
  );
}

function StoreDashboard({
  store,
  prev,
  threshold,
  labels,
  trends,
}: {
  store: StoreReport;
  prev: PeriodTotals | null;
  threshold: number;
  labels: Partial<Record<IncentiveGroup, string>>;
  trends: StoreTrends | null;
}) {
  const running = store.daysGone < store.daysInMonth;
  const daysLeft = Math.max(0, store.daysInMonth - store.daysGone);
  const abv = store.bills ? store.net / store.bills : 0;
  const upb = store.bills ? store.units / store.bills : 0;
  const discPct = store.gross ? store.discount / store.gross : 0;
  const retPct = store.invoiceNet ? store.returns / store.invoiceNet : 0;
  const othersPct = store.invoiceNet ? store.othersNet / store.invoiceNet : 0;
  const perDayNow = store.daysGone ? store.net / store.daysGone : 0;
  const neededPerDay = running && store.target > store.net ? (store.target - store.net) / Math.max(1, daysLeft) : 0;
  const projected = store.daysGone ? (store.net / store.daysGone) * store.daysInMonth : 0;
  const prevAbv = prev && prev.bills ? prev.net / prev.bills : null;
  const prevUpb = prev && prev.bills ? prev.units / prev.bills : null;

  const sellers = store.people.filter((p) => p.bills > 0);
  const best = [...sellers].sort((a, b) => b.net - a.net)[0];
  const bestAbv = [...sellers].filter((p) => p.bills >= 10).sort((a, b) => b.abv - a.abv)[0];
  const lowUpb = [...sellers].filter((p) => p.bills >= 10).sort((a, b) => a.units / a.bills - b.units / b.bills)[0];
  const topDisc = [...sellers].sort((a, b) => b.discount - a.discount)[0];
  // Store Managers are measured on the store, not on their own billing — left out here.
  const noSales = store.people.filter((p) => p.bills === 0 && p.attendance.duties > 0 && p.targetApplies && ["sales", "asm"].includes(p.group));
  const noTarget = store.people.filter((p) => p.targetApplies && p.target === null && p.group !== "none" && p.bills > 0);

  // Things for the Store Manager to act on (most important first).
  const act: { tone: "bad" | "warn" | "good"; text: string }[] = [];
  if (running && store.target) {
    if (projected < store.target)
      act.push({ tone: "bad", text: `At today's pace (${rupees(perDayNow)} a day) the store ends the month near ${short(projected)} — ${pct(projected / store.target)} of target. It needs ${rupees(neededPerDay)} a day from now.` });
    else act.push({ tone: "good", text: `On pace for ${short(projected)} (${pct(projected / store.target)} of target). Keep ${rupees(neededPerDay || perDayNow)} a day.` });
  }
  if (prev) {
    const c = change(store.net, prev.net);
    if (c !== null) act.push({ tone: c >= 0 ? "good" : "bad", text: `Sales are ${c >= 0 ? "up" : "down"} ${Math.abs(c * 100).toFixed(0)}% on the same ${store.daysGone} day(s) of last month (${short(prev.net)}).` });
  }
  if (othersPct > 0.02) act.push({ tone: "bad", text: `${pct(othersPct, 1)} of sales (${short(store.othersNet)}, ${store.othersBills} bills) are “Others” — no salesperson on the bill. Make sure every bill carries the salesperson.` });
  if (discPct > threshold / 100 / 2 || store.flagged.length)
    act.push({ tone: store.flagged.length ? "warn" : "good", text: `Discounts: ${short(store.discount)} (${pct(discPct, 1)} of sales). ${store.flagged.length} bill(s) over ${threshold}%${topDisc && topDisc.discount > 0 ? ` — most by ${topDisc.name} (${rupees(topDisc.discount)})` : ""}.` });
  if (trends?.uncategorized.units)
    act.push({
      tone: "warn",
      text: `Products not categorised: ${trends.uncategorized.units} item(s) sold this month (${short(trends.uncategorized.net)}) have no category in Zoho — e.g. ${trends.uncategorized.items
        .slice(0, 4)
        .map((i) => i.name)
        .join(", ")}. Ask the back office to set them.`,
    });
  if (retPct > 0.01) act.push({ tone: "warn", text: `Returns took ${short(store.returns)} (${pct(retPct, 1)} of sales, ${store.returnCount} return(s)). Check why with the team.` });
  if (prevUpb !== null && upb < prevUpb) act.push({ tone: "warn", text: `Items per bill fell to ${upb.toFixed(2)} from ${prevUpb.toFixed(2)}. One more add-on per bill is the quickest way to grow sales.` });
  if (lowUpb && lowUpb.units / lowUpb.bills < upb * 0.8) act.push({ tone: "warn", text: `${lowUpb.name} sells ${(lowUpb.units / lowUpb.bills).toFixed(1)} items per bill (store ${upb.toFixed(1)}) — coach on add-on selling.` });
  const lateList = [...store.people].filter((p) => p.attendance.late > 0).sort((a, b) => b.attendance.late - a.attendance.late || b.attendance.lateMinutes - a.attendance.lateMinutes);
  if (lateList.length)
    act.push({
      tone: lateList.some((p) => p.attendance.late >= 3) ? "bad" : "warn",
      text: `Late comings: ${lateList
        .slice(0, 5)
        .map((p) => `${p.name.split(" ").slice(0, 2).join(" ")} ${p.attendance.late}× (${p.attendance.lateMinutes} min)`)
        .join(", ")}. Open Duties to see the days.`,
    });
  if (noSales.length) act.push({ tone: "bad", text: `${noSales.map((p) => p.name).join(", ")} came to work but have no sales this month.` });
  if (noTarget.length) act.push({ tone: "warn", text: `${noTarget.length} person(s) selling without a target this month: ${noTarget.slice(0, 5).map((p) => p.name).join(", ")}.` });
  if (best) act.push({ tone: "good", text: `Top seller: ${best.name} — ${rupees(best.net)} from ${best.bills} bills.` });
  if (bestAbv) act.push({ tone: "good", text: `Best average bill: ${bestAbv.name} — ${rupees(bestAbv.abv)}.` });
  for (const sc of store.spotCounts) if (sc.count) act.push({ tone: "good", text: `${sc.count} ${sc.name} bill(s) so far.` });

  return (
    <>
      {store.month === todayISO().slice(0, 7) && (
        <TodayStrip
          day={store.today}
          label={`${store.store} store`}
          needed={store.target ? Math.max(0, (store.target - (store.net - store.today.net)) / Math.max(1, daysLeft + 1)) : 0}
          target={store.target ? "store target" : null}
        />
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Bills" value={store.bills} note={prev ? <Delta now={store.bills} before={prev.bills} /> : `${store.units} items`} />
        <Tile label="Avg bill (ABV)" value={rupees(abv)} note={<Delta now={abv} before={prevAbv} money />} />
        <Tile label="Items per bill (UPB)" value={upb.toFixed(2)} note={<Delta now={upb} before={prevUpb} digits={2} />} tone={prevUpb !== null && upb < prevUpb ? "warn" : "default"} />
        <Tile label="Discount given" value={short(store.discount)} note={`${pct(discPct, 1)} · ${store.flagged.length} bill(s) over ${threshold}%`} tone={store.flagged.length ? "warn" : "default"} />
        <Tile label="Returns" value={short(store.returns)} note={`${store.returnCount} return(s) · ${pct(retPct, 1)}`} tone={store.returns ? "bad" : "default"} />
        <Tile label="Others" value={short(store.othersNet)} note={`${store.othersBills} bills · ${pct(othersPct, 1)} of sales`} tone={othersPct > 0.02 ? "bad" : "default"} />
      </div>
      <Panel title="For the Store Manager" intro={`${store.daysGone} of ${store.daysInMonth} days gone${running ? ` · ${daysLeft} day(s) left` : ""}. What to act on now.`}>
        <ul className="space-y-2 text-sm">
          {act.map((a) => (
            <li key={a.text} className="flex gap-2">
              <span aria-hidden>{a.tone === "bad" ? "🔴" : a.tone === "warn" ? "🟠" : "🟢"}</span>
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-black/45">Groups: {[...new Set(store.people.map((p) => groupName(p.group, labels)))].join(" · ")}</p>
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------
// Management only: sales against salary
// ------------------------------------------------------------------

type Worth = { salary: number; ratio: number | null; incentiveShare: number | null; verdict: { text: string; cls: string } };

/** Management only: sales for every ₹1 of salary (salary counted for the days gone so far). */
/** Net sales, bills and items a person is measured on: their own, or the store's for groups without individual targets (Store Manager). */
function measureOf(p: StoreReport["people"][number], store: StoreReport) {
  if (p.targetApplies || p.poolOnly) return { isStore: false, net: p.net, bills: p.bills, units: p.units, abv: p.abv };
  return { isStore: true, net: store.net, bills: store.bills, units: store.units, abv: store.bills ? store.net / store.bills : 0 };
}

function worthOf(store: StoreReport, salaries: Record<string, number>, salesPerSalary: number) {
  const part = store.daysGone / store.daysInMonth || 1;
  const rows = store.people.map((p) => {
    const salary = salaries[p.userId] ?? 0;
    const cost = salary * part;
    return { p, salary, cost, ratio: cost > 0 ? p.net / cost : null, incentiveShare: salary > 0 ? p.total / salary : null };
  });
  // Store Manager: measured on the store — store sales for every ₹1 of the whole team's salary.
  const teamCost = rows.reduce((s, r) => s + r.cost, 0);
  for (const r of rows) if (!r.p.targetApplies && !r.p.poolOnly && r.cost > 0) r.ratio = teamCost > 0 ? store.net / teamCost : null;
  const withRatio = rows.filter((r) => r.ratio !== null && r.p.bills > 0 && r.p.targetApplies).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const avg = withRatio.length ? withRatio.reduce((s, r) => s + r.p.net, 0) / withRatio.reduce((s, r) => s + r.cost, 0) : 0;
  const totalSalary = rows.reduce((s, r) => s + r.cost, 0);
  const missing = rows.filter((r) => !r.salary).length;
  const verdict = (r: (typeof rows)[number]) => {
    if (r.ratio === null) return { text: "Salary not entered", cls: "text-black/35" };
    if (r.p.poolOnly) return { text: "No sales role (store pool)", cls: "text-black/45" };
    if (!r.p.targetApplies) return { text: "Store (whole team)", cls: "text-black/60" };
    if (!r.p.bills) return { text: "No sales", cls: "text-black/45" };
    if (salesPerSalary && r.ratio < salesPerSalary) return { text: `Below ${salesPerSalary}× — review`, cls: "font-semibold text-[#d6224a]" };
    if (avg && r.ratio >= avg * 1.25) return { text: "Star", cls: "font-semibold text-green-700" };
    if (avg && r.ratio < avg * 0.75) return { text: "Below store — watch", cls: "font-semibold text-amber-700" };
    return { text: "In line", cls: "text-black/60" };
  };
  const map = new Map<string, Worth>(rows.map((r) => [r.p.userId, { salary: r.salary, ratio: r.ratio, incentiveShare: r.incentiveShare, verdict: verdict(r) }]));
  const tips: string[] = [];
  if (totalSalary) tips.push(`Salaries for these ${store.daysGone} days: ${rupees(totalSalary)} — ${pct(totalSalary / Math.max(1, store.net), 1)} of the store's net sales.`);
  if (avg) tips.push(`The store sells ${rupees(avg)} for every ₹1 of salary.`);
  const top = withRatio[0];
  const low = withRatio[withRatio.length - 1];
  if (top && low && top !== low) tips.push(`Best value: ${top.p.name} (${rupees(top.ratio!)} per ₹1). Lowest: ${low.p.name} (${rupees(low.ratio!)} per ₹1).`);
  if (missing) tips.push(`${missing} person(s) have no salary entered (Settings → Sales targets & incentives → Edit targets).`);
  return { map, tips };
}

// ------------------------------------------------------------------
// Action plans
// ------------------------------------------------------------------

type FollowCtx = { store: string; month: string; now: Record<string, Follow>; before: Record<string, Follow>; canEdit: boolean };

function PlanList({ items, role, follow }: { items: PlanItem[]; role: PlanRole; follow?: FollowCtx | null }) {
  const order = { high: 0, medium: 1, good: 2 } as const;
  const PRI = { high: { t: "High", c: "bg-red-100 text-red-800" }, medium: { t: "Medium", c: "bg-amber-100 text-amber-800" }, good: { t: "Opportunity", c: "bg-green-100 text-green-800" } } as const;
  return (
    <ol className="space-y-3">
      {[...items]
        .sort((a, b) => order[a.priority] - order[b.priority])
        .map((it, i) => {
          const v = planView(role, it);
          const f = follow?.now[v.key];
          const last = follow?.before[v.key];
          return (
            <li key={`${v.key}-${i}`} className="rounded-2xl bg-white p-3 ring-1 ring-black/5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${PRI[it.priority].c}`}>{PRI[it.priority].t}</span>
                  {v.observation}
                </p>
                {last && (
                  <span className="rounded-full bg-[#8883d7]/10 px-2 py-0.5 text-[10px] font-bold text-[#5b55c9]" title={last.note ?? ""}>
                    Recurring · last month {last.status.replace("_", " ")}
                  </span>
                )}
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[110px_1fr]">
                <dt className="font-bold text-black/45">{v.kind}</dt>
                <dd className="text-black/70">{v.observation}</dd>
                <dt className="font-bold text-black/45">Action</dt>
                <dd className="text-black/80">{v.action}</dd>
                <dt className="font-bold text-black/45">Who · by when</dt>
                <dd className="text-black/70">
                  {v.owner} · {v.timeframe}
                </dd>
                <dt className="font-bold text-black/45">Expected</dt>
                <dd className="text-black/70">{v.outcome}</dd>
              </dl>
              {follow && (
                <div className="mt-2 border-t border-black/5 pt-2">
                  <PlanFollow
                    store={follow.store}
                    month={follow.month}
                    role={role}
                    pkey={v.key}
                    title={v.observation}
                    status={f?.status ?? "open"}
                    note={f?.note ?? null}
                    by={f?.updated_by ?? null}
                    at={f?.updated_at ?? null}
                    canEdit={follow.canEdit}
                  />
                </div>
              )}
            </li>
          );
        })}
    </ol>
  );
}

function ActionPlans({ plans, follow }: { plans: { role: PlanRole; label: string; items: PlanItem[] }[]; follow: FollowCtx | null }) {
  return (
    <Panel title="Action plans" intro="From this store's actual figures (sales pace, last 7 days against the 7 before, people, categories, stock). Each point has an owner, a time and an expected result; update its status as you act. Points seen last month are marked Recurring.">
      <div className="space-y-2">
        {plans.map(({ role, label, items }, i) => (
          <details key={role} open={i === 0} className="group rounded-2xl ring-1 ring-black/5 open:bg-black/[0.015]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <span className="font-bold">{label}</span>
              <span className="text-xs text-black/45">
                {items.filter((x) => x.priority === "high").length} urgent · {items.length} points <span className="ml-1 inline-block transition group-open:rotate-180">▾</span>
              </span>
            </summary>
            <div className="px-4 pb-4">{items.length ? <PlanList items={items} role={role} follow={follow} /> : <p className="text-sm text-black/50">Nothing urgent.</p>}</div>
          </details>
        ))}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------
// Peak and lean hours / days
// ------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PeakLean({
  title,
  intro,
  hours,
  timed,
  total,
  days,
  store,
  rules,
  lastSyncAt,
}: {
  title: string;
  intro: string;
  hours: { hour: number; net: number; bills: number }[];
  timed: number;
  total: number;
  days: { date: string; net: number; bills: number }[];
  store: string;
  rules: Pick<PerformanceSettings, "storeHours" | "specialDays" | "leanBelowPct" | "shortDayPct">;
  lastSyncAt: string | null;
}) {
  // Only closed days with complete data count (today is live; days not copied after closing are provisional).
  const stateOf = (date: string) => dayState(rules, store, date, lastSyncAt);
  const live = days.filter((d) => stateOf(d.date) === "live" && d.bills > 0);
  const provisional = days.filter((d) => stateOf(d.date) === "provisional" && d.bills > 0);
  const special = days.filter((d) => stateOf(d.date) === "special" && d.bills > 0);
  const pl = peakLeanDays(days, stateOf, rules);
  const hl = peakLeanHours(hours);
  const peakH = new Set(hl?.peak.map((h) => h.hour) ?? []);
  const leanH = new Set(hl?.lean.map((h) => h.hour) ?? []);
  const shown = hours.filter((h) => h.bills > 0);
  const maxH = Math.max(1, ...shown.map((h) => h.net));

  const open = days.filter((d) => d.bills > 0 && stateOf(d.date) === "closed");
  const wd = WEEKDAYS.map((name, i) => {
    const list = open.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === i);
    return { name, i, avg: list.length ? list.reduce((s, d) => s + d.net, 0) / list.length : 0, n: list.length };
  });
  const withData = wd.filter((w) => w.n);
  const peakW = [...withData].sort((a, b) => b.avg - a.avg)[0];
  const leanW = withData.length > 2 ? [...withData].sort((a, b) => a.avg - b.avg)[0] : null;
  const maxW = Math.max(1, ...wd.map((w) => w.avg));
  const peakDays = pl.peak;
  const leanDays = pl.lean;
  const total$ = shown.reduce((s, h) => s + h.net, 0) || 1;

  return (
    <Panel title={title} intro={intro}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">By hour of the day</p>
          {shown.length ? (
            <>
              <div className="mt-3 flex h-36 items-end gap-1">
                {shown.map((h) => (
                  <div key={h.hour} className="flex flex-1 flex-col items-center gap-1" title={`${hourRange(h.hour)}: ${rupees(h.net)} · ${h.bills} bills`}>
                    <div
                      className={`w-full rounded-t ${peakH.has(h.hour) ? "bg-green-500" : leanH.has(h.hour) ? "bg-[#ff5e79]" : "bg-[#8883d7]/70"}`}
                      style={{ height: `${Math.max(3, (h.net / maxH) * 120)}px` }}
                    />
                    <span className="text-[9px] text-black/45">{hourRange(h.hour).split("–")[0].replace(" ", "")}</span>
                  </div>
                ))}
              </div>
              {hl && (
                <p className="mt-2 text-sm">
                  <span className="font-semibold text-green-700">Peak:</span> {hl.peak.map((h) => hourRange(h.hour)).join(", ")} ({pct(hl.peak.reduce((s, h) => s + h.net, 0) / total$)} of sales) ·{" "}
                  <span className="font-semibold text-[#d6224a]">Lean:</span> {hl.lean.map((h) => hourRange(h.hour)).join(", ")} ({pct(hl.lean.reduce((s, h) => s + h.net, 0) / total$)})
                </p>
              )}
              {timed < total && <p className="mt-1 text-xs text-black/45">Bill times known for {timed} of {total} bills; the rest fill in as bills are copied again.</p>}
            </>
          ) : (
            <p className="mt-2 text-sm text-black/50">Bill times are being collected — this fills in after the next copy from Zoho.</p>
          )}
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-black/45">By day of the week (average)</p>
          <div className="mt-3 flex h-36 items-end gap-2">
            {wd.map((w) => (
              <div key={w.i} className="flex flex-1 flex-col items-center gap-1" title={`${w.name}: ${rupees(w.avg)} on average (${w.n} day(s))`}>
                <div
                  className={`w-full rounded-t ${peakW && w.i === peakW.i ? "bg-green-500" : leanW && w.i === leanW.i ? "bg-[#ff5e79]" : "bg-[#8883d7]/70"} ${w.n ? "" : "opacity-20"}`}
                  style={{ height: `${Math.max(3, (w.avg / maxW) * 120)}px` }}
                />
                <span className="text-[10px] text-black/50">{w.name}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-semibold text-green-700">Peak days</p>
              {peakDays.map((d) => (
                <p key={d.date} className="text-black/70">
                  {formatDate(d.date)} · {rupees(d.net)}
                </p>
              ))}
            </div>
            {leanDays.length > 0 && (
              <div>
                <p className="font-semibold text-[#d6224a]">Lean days</p>
                {leanDays.map((d) => (
                  <p key={d.date} className="text-black/70">
                    {formatDate(d.date)} · {rupees(d.net)}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-black/50">
            {live.map((d) => (
              <p key={d.date}>
                ● Today {formatDate(d.date)} so far {rupees(d.net)} — live, not compared until the store closes.
              </p>
            ))}
            {provisional.length > 0 && <p>Provisional (closed, waiting for the last copy from Zoho): {provisional.map((d) => formatDate(d.date)).join(", ")}.</p>}
            {pl.short.length > 0 && (
              <p>
                Short days (under {Math.round(rules.shortDayPct * 100)}% of a usual day — closed early or data missing, not counted as lean):{" "}
                {pl.short.map((d) => `${formatDate(d.date)} ${rupees(d.net)}`).join(", ")}.
              </p>
            )}
            {special.length > 0 && <p>Holidays / special days left out: {special.map((d) => formatDate(d.date)).join(", ")}.</p>}
            <p>
              Lean = closed days below {Math.round(rules.leanBelowPct * 100)}% of the usual day ({rupees(pl.median)}). Store closes at {hoursOf(rules, store).close}.
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
