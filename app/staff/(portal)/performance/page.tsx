import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentStaff } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { attendanceCode } from "@/lib/attendance";
import { formatDate, formatDateTime, todayISO } from "@/lib/helpers";
import { monthReport, personDetail, type PersonReport, type StoreReport } from "@/lib/performance";
import { performanceAccess } from "@/lib/performance-access";
import { groupName, isMonth, monthRange, pct, rupees, type IncentiveGroup } from "@/lib/performance-rules";
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
  const [report, access] = await Promise.all([monthReport(month), performanceAccess(staff)]);
  const allStores = report.stores.map((s) => s.store);
  const myStores = access.teamAll ? allStores : allStores.filter((s) => access.teamStores.includes(s));
  // Only people in an incentive group have their own page; managers see their stores.
  if (!access.eligible && !access.teamAll && !access.teamStores.length) redirect("/staff");
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
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ff5e79]">Sales performance</p>
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
      {myStores.map((s) => (
        <Link key={s} href={qs(base, { view: "team", store: s })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${teamStore === s ? "bg-[#8883d7] text-white" : "hover:bg-black/5"}`}>
          {s}
        </Link>
      ))}
      {isAdmin(staff.role) && (
        <Link href="/staff/admin/performance" className="ml-auto rounded-full px-3 py-1.5 text-sm font-semibold text-[#8883d7] hover:bg-black/5">
          🎯 Targets &amp; settings
        </Link>
      )}
    </div>
  ) : null;

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
    return (
      <div className="space-y-6">
        {header}
        {switcher}
        <TeamView store={store} base={base} threshold={report.settings.highDiscountPct} canExport={isAdmin(staff.role)} labels={labels} />
      </div>
    );
  }

  if (!found) {
    return (
      <div className="space-y-6">
        {header}
        {switcher}
        <Panel title="No sales found for you this month">
          <p className="text-sm text-black/60">
            Sales are matched by your User ID ({staff.userId}) as the salesperson on the Zoho POS bill (for example “{staff.userId} - {staff.fullName.split(" ")[0]?.toUpperCase()}”).
            If you billed under another name, ask the admin to link it.
          </p>
        </Panel>
      </div>
    );
  }

  const detail = await personDetail(month, found.person.userId, report.settings.highDiscountPct / 100, report.rules);
  return (
    <div className="space-y-6">
      {header}
      {switcher}
      <PersonView p={found.person} store={found.store} detail={detail} threshold={report.settings.highDiscountPct} rules={report.rules} labels={labels} />
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
  const neededForNext = next && p.target ? Math.max(0, next.from * p.target - p.net) : 0;
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
            <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-black/45">Net sales (after discounts &amp; returns, without tax)</p>
            <p className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl">{rupees(p.net)}</p>
            <p className="mt-1 text-sm text-black/55">
              {p.target ? (
                <>
                  Target {rupees(p.target)} · <b className="text-black">{pct(p.achievement ?? 0)}</b> achieved
                </>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Bills" value={p.bills} note={`${p.units} items sold`} />
        <Tile label="Avg bill (ABV)" value={rupees(p.abv)} note={p.abvTarget ? `Target ${rupees(p.abvTarget)}` : `Team ${rupees(teamAbv)}`} tone={teamAbv && p.abv >= teamAbv ? "good" : "default"} />
        <Tile label="Discount given" value={rupees(p.discount)} note={`${pct(p.discountPct, 1)} of sales · ${p.flaggedBills} bill(s) over ${threshold}%`} tone={p.flaggedBills ? "warn" : "default"} />
        <Tile label="Returns" value={rupees(p.returns)} note={`${p.returnCount} return(s)`} tone={p.returns ? "bad" : "default"} />
        <Tile
          label="Duties"
          value={att.found ? `${att.duties + att.noData}/${att.required}` : "—"}
          note={att.found ? (att.absences ? `${att.absences} short → ${pct(att.share)} paid` : att.noData ? `incl. ${att.noData} day(s) without punching data` : "On track") : "No attendance found"}
          tone={att.absences ? "bad" : "default"}
        />
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
}: {
  store: StoreReport;
  base: Search;
  threshold: number;
  canExport: boolean;
  labels: Partial<Record<IncentiveGroup, string>>;
}) {
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
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-black/45">Store net sales (after discounts &amp; returns, without tax)</p>
            <p className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl">{short(store.net)}</p>
            <p className="mt-1 text-sm text-black/55">
              Target {short(store.target)} · <b className="text-black">{pct(store.achievement)}</b> · {store.bills} bills · returns {short(store.returns)} · discounts {short(store.discount)}
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
            ⚠️ {store.othersBills} bill(s) worth {short(store.othersNet)} have no salesperson on the bill. They count for the store, but for nobody&apos;s individual sales.
          </p>
        )}
      </section>

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
                <th className={`${thc} text-right`}>Disc.</th>
                <th className={`${thc} text-right`}>Returns</th>
                <th className={`${thc} text-right`}>Duties</th>
                <th className={`${thc} text-right`}>Store share</th>
                <th className={`${thc} text-right`}>Bonus</th>
                <th className={`${thc} text-right`}>Spot</th>
                <th className={`${thc} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {store.people.map((p) => (
                <tr key={p.userId} className="border-t border-black/5 hover:bg-black/[0.02]">
                  <td className={tdc}>
                    <Link href={qs(base, { u: p.userId })} className="font-semibold text-[#5b55c9] hover:underline">
                      {p.name}
                    </Link>
                    <span className="ml-1.5 text-xs text-black/40">{p.userId}</span>
                  </td>
                  <td className={`${tdc} text-black/60`}>{groupName(p.group, labels)}</td>
                  <td className={`${tdc} text-right font-semibold`}>{rupees(p.net)}</td>
                  <td className={`${tdc} text-right text-black/60`}>{p.target ? rupees(p.target) : "—"}</td>
                  <td className={`${tdc} text-right font-semibold ${p.achievement === null ? "text-black/30" : p.achievement >= 1 ? "text-green-700" : p.achievement >= 0.9 ? "text-amber-600" : "text-[#d6224a]"}`}>
                    {p.achievement === null ? "—" : pct(p.achievement)}
                  </td>
                  <td className={`${tdc} text-right`}>{p.bills}</td>
                  <td className={`${tdc} text-right`}>{p.bills ? rupees(p.abv) : "—"}</td>
                  <td className={`${tdc} text-right ${p.flaggedBills ? "font-semibold text-[#d6224a]" : ""}`}>
                    {pct(p.discountPct, 1)}
                    {p.flaggedBills ? <span className="ml-1 text-xs">⚑{p.flaggedBills}</span> : null}
                  </td>
                  <td className={`${tdc} text-right`}>{p.returns ? rupees(p.returns) : "—"}</td>
                  <td className={`${tdc} text-right ${p.attendance.absences ? "font-semibold text-[#d6224a]" : ""}`}>{p.attendance.found ? `${p.attendance.duties + p.attendance.noData}/${p.attendance.required}` : "—"}</td>
                  <td className={`${tdc} text-right`}>{rupees(p.storeShare)}</td>
                  <td className={`${tdc} text-right`}>{rupees(p.bonus)}</td>
                  <td className={`${tdc} text-right`}>{rupees(p.spotTotal)}</td>
                  <td className={`${tdc} text-right font-bold text-green-700`}>{rupees(p.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-black/10 font-bold">
                <td className={tdc} colSpan={10}>
                  Total
                </td>
                <td className={`${tdc} text-right`}>{rupees(totals.share)}</td>
                <td className={`${tdc} text-right`}>{rupees(totals.bonus)}</td>
                <td className={`${tdc} text-right`}>{rupees(totals.spot)}</td>
                <td className={`${tdc} text-right text-green-700`}>{rupees(totals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
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
