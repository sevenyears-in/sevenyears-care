// End-of-day report per store (server only), kept in daily_store_reports (one row per day + store).
//
// When: after the store's closing time + 30 minutes AND after a copy from Zoho POS that ran after closing
// ("final"). If no copy has worked by 11:15 pm, the report is made anyway and marked "provisional".
// A provisional report is made again (store figures only) once a later copy works, and marked final;
// it is e-mailed again only when the figures changed.
// No duplicates: the row is claimed first (primary key day + store); a second tick / process stops there.

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { monthReport } from "@/lib/performance";
import { closingAt, istNow, isSpecialDay } from "@/lib/business-day";
import { dailySales } from "@/lib/daily-sales";
import { storeReportLines } from "@/lib/report-format";
import { loadWalkins } from "@/lib/walkins";
import { itemSales, stockAlertsFor } from "@/lib/stock";
import { isAdmin, asRole } from "@/lib/roles";
import { sendEmail, siteUrl } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";
import { syncRecentSales } from "@/lib/sales-sync";
import type { AlertAudience, PerformanceSettings } from "@/lib/performance-rules";

export type EodData = {
  store: string;
  day: string;
  net: number;
  billed: number;
  returned: number;
  bills: number;
  units: number | null;
  abv: number;
  upb: number | null;
  dayTarget: number;
  achievement: number | null;
  prevNet: number | null;
  monthNet: number | null;
  monthTarget: number | null;
  monthAchievement: number | null;
  daysLeft: number | null;
  people: { name: string; net: number; bills: number }[] | null;
  noSales: string[] | null;
  categories: { name: string; units: number; net: number }[];
  products: { name: string; units: number; net: number }[];
  stock: { lowFast: number; out: number } | null;
  lastSyncAt: string | null;
  teamAsAt: string | null;
  /** Walk-ins posted by the CRE for the day (null = not posted). Missing on reports made before walk-ins existed. */
  walkins?: number | null;
  daysInMonth?: number;
  dayOfMonth?: number;
};

export type EodRow = {
  day: string;
  store: string;
  status: "generating" | "provisional" | "final" | "failed";
  data: EodData | null;
  generated_at: string | null;
  regenerated_at: string | null;
  emailed_at: string | null;
  email_result: { sent: number; failed: number; skipped: number; to: string[] } | null;
  error: string | null;
};

const LATEST_PROVISIONAL = 23 * 60 + 15; // 11:15 pm
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/** Builds the report figures for one store and day. Team lines only when `day` is today (live month report). */
export async function buildEod(store: string, day: string, s: PerformanceSettings): Promise<EodData> {
  const monthStart = `${day.slice(0, 7)}-01`;
  const [rows, items, w] = await Promise.all([dailySales(monthStart, day, [store], false), itemSales(store, day, day), loadWalkins(store, day).catch(() => null)]);
  const r = rows.find((x) => x.date === day && x.store === store);
  const isToday = istNow().date === day;
  const [y, mo] = day.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const dayOfMonth = Number(day.slice(8, 10));
  // Month to date and month target from the day-wise figures (works for any day, not only today).
  let monthNet: number | null = rows.filter((x) => x.store === store && x.date <= day).reduce((a, x) => a + x.net, 0);
  let monthTarget: number | null = r && r.target > 0 ? Math.round(r.target * daysInMonth) : null;
  let daysLeft: number | null = daysInMonth - dayOfMonth;
  let people: EodData["people"] = null;
  let noSales: string[] | null = null;
  let units: number | null = null;
  if (isToday) {
    const rep = await monthReport(day.slice(0, 7), true);
    const st = rep.stores.find((x) => x.store === store);
    if (st) {
      monthNet = st.net;
      monthTarget = st.target || null;
      daysLeft = Math.max(0, st.daysInMonth - st.daysGone);
      units = st.today.units;
      const sellers = st.people.filter((p) => p.targetApplies && !p.poolOnly);
      people = sellers
        .filter((p) => p.today.bills > 0 || p.today.net !== 0)
        .sort((a, b) => b.today.net - a.today.net)
        .map((p) => ({ name: p.name, net: Math.round(p.today.net), bills: p.today.bills }));
      noSales = sellers.filter((p) => p.today.bills === 0).map((p) => p.name);
    }
  }
  const cats = new Map<string, { units: number; net: number }>();
  for (const it of items.values()) {
    const c = it.c || "Not categorised";
    const x = cats.get(c) ?? { units: 0, net: 0 };
    x.units += it.u;
    x.net += it.v;
    cats.set(c, x);
  }
  const categories = [...cats.entries()].map(([name, v]) => ({ name, units: v.units, net: Math.round(v.net) })).sort((a, b) => b.net - a.net).slice(0, 6);
  const products = [...items.values()].map((it) => ({ name: it.n ?? it.s ?? it.k, units: it.u, net: Math.round(it.v) })).sort((a, b) => b.net - a.net).slice(0, 6);
  const stock = isToday ? await stockAlertsFor(store).then((a) => ({ lowFast: a.lowFast, out: a.out.length })).catch(() => null) : null;
  const net = r?.net ?? 0;
  const bills = r?.bills ?? 0;
  return {
    store,
    day,
    net,
    billed: r?.billed ?? 0,
    returned: r?.returned ?? 0,
    bills,
    units,
    abv: bills ? net / bills : 0,
    upb: bills && units !== null ? units / bills : null,
    dayTarget: r?.target ?? 0,
    achievement: r?.achievement ?? null,
    prevNet: r?.prevNet ?? null,
    monthNet,
    monthTarget,
    monthAchievement: monthNet !== null && monthTarget ? monthNet / monthTarget : null,
    daysLeft,
    people,
    noSales,
    categories,
    products,
    stock,
    lastSyncAt: s.lastSyncAt ?? null,
    teamAsAt: isToday ? new Date().toISOString() : null,
    walkins: w?.count ?? null,
    daysInMonth,
    dayOfMonth,
  };
}

/** The closing report in the stores' layout (same as the 3-hourly updates, marked "Closing"). */
export function eodBlock(d: EodData): string[] {
  const [y, mo] = d.day.split("-").map(Number);
  return storeReportLines({
    store: d.store,
    day: d.day,
    when: "Closing",
    closing: true,
    monthTarget: d.monthTarget ?? 0,
    daysInMonth: d.daysInMonth ?? new Date(Date.UTC(y, mo, 0)).getUTCDate(),
    dayOfMonth: d.dayOfMonth ?? Number(d.day.slice(8, 10)),
    net: d.net,
    bills: d.bills,
    mtd: d.monthNet,
    paceShort: null,
    walkins: d.walkins ?? null,
  });
}

/** Plain-text report (e-mail and in-app). */
export function eodText(d: EodData, status: "provisional" | "final") {
  const lines = [
    ...eodBlock(d),
    `Returns: ${rupees(d.returned)} (billed ${rupees(d.billed)})${d.upb !== null ? ` | Items per bill: ${d.upb.toFixed(1)}` : ""}${d.prevNet !== null ? ` | Previous day: ${rupees(d.prevNet)}` : ""}`,
  ];
  if (status === "provisional") lines.push("PROVISIONAL: the last copy from Zoho POS after closing has not worked yet — it is made again once it does.");
  if (d.people?.length) lines.push("", "Team today:", ...d.people.slice(0, 15).map((p) => `  ${p.name}: ${rupees(p.net)} (${p.bills} bill(s))`));
  if (d.noSales?.length) lines.push(`No bills today: ${d.noSales.join(", ")}.`);
  if (d.categories.length) lines.push("", "Top categories:", ...d.categories.map((c) => `  ${c.name}: ${rupees(c.net)} (${c.units} item(s))`));
  if (d.products.length) lines.push("", "Top products:", ...d.products.map((p) => `  ${p.name}: ${rupees(p.net)} (${p.units})`));
  if (d.stock) lines.push("", `Stock: ${d.stock.lowFast} fast mover(s) low, ${d.stock.out} item(s) out of stock that sold in the last 60 days.`);
  lines.push("", `Full report: ${siteUrl()}/staff/performance/reports?day=${d.day}&store=${encodeURIComponent(d.store)}`);
  return lines.join("\n");
}

export type Recipient = { id: string; full_name: string; email: string | null; notify_email: boolean | null; audience: AlertAudience };

/** Store Managers / ASM of the store and the management that looks after it. */
export async function recipients(store: string): Promise<Recipient[]> {
  const { data } = await supabaseAdmin
    .from("staff_users")
    .select("id, full_name, role, store_name, email, notify_email, director_stores, incentive_group")
    .eq("is_active", true);
  const out: Recipient[] = [];
  for (const r of (data ?? []) as { id: string; full_name: string; role: string; store_name: string | null; email: string | null; notify_email: boolean | null; director_stores: string[] | null; incentive_group: string | null }[]) {
    const role = asRole(r.role);
    const own = (r.store_name ?? "").toUpperCase() === store;
    if (isAdmin(role) || role === "operations_manager") out.push({ ...r, audience: "management" });
    else if (role === "director") {
      const mine = (r.director_stores ?? []).map((x) => x.toUpperCase());
      if (!mine.length || mine.includes(store)) out.push({ ...r, audience: "management" });
    } else if (own && (role === "store_manager" || r.incentive_group === "sm" || r.incentive_group === "asm")) out.push({ ...r, audience: "sm" });
  }
  return out;
}

async function deliverEod(d: EodData, status: "provisional" | "final", emailTo: AlertAudience[], again = false) {
  const people = await recipients(d.store);
  const title = `${again ? "Updated: " : ""}End of day ${d.day} · ${d.store}${status === "provisional" ? " (provisional)" : ""}`;
  const text = eodText(d, status);
  if (people.length)
    await supabaseAdmin.from("staff_notifications").insert(people.map((p) => ({ staff_id: p.id, ticket_type: null, ticket_id: null, ticket_number: null, title, body: text.split("\n").slice(0, 8).join("\n") })));
  await pushToStaff(people.map((p) => p.id), { title, body: `Net ${rupees(d.net)} from ${d.bills} bill(s)${d.dayTarget ? ` — ${pct(d.achievement)} of the day target` : ""}.`, url: `${siteUrl()}/staff/performance/reports` }).catch(() => undefined);
  const result = { sent: 0, failed: 0, skipped: 0, to: [] as string[] };
  for (const p of people) {
    if (!emailTo.includes(p.audience)) continue;
    if (!p.email || p.notify_email === false) {
      result.skipped++;
      continue;
    }
    const r = await sendEmail(p.email, `${title} — Seven Years`, `Hello ${p.full_name},\n\n${text}\n\n— Seven Years Care`, { audience: "staff", ticketNumber: `EOD ${d.day} ${d.store}` });
    if (r.ok) {
      result.sent++;
      result.to.push(p.full_name);
    } else if (/not set up/i.test(r.error ?? "")) result.skipped++;
    else result.failed++;
  }
  return result;
}

const g = globalThis as unknown as { __syEodBusy?: boolean; __syEodSyncAt?: number };

/** Claims and makes one report. Returns what happened. */
async function makeReport(store: string, day: string, status: "provisional" | "final", s: PerformanceSettings) {
  const { error: claim } = await supabaseAdmin.from("daily_store_reports").insert({ day, store, status: "generating" });
  if (claim) return /duplicate|23505/i.test(`${claim.code} ${claim.message}`) ? "already made" : `could not claim: ${claim.message}`;
  try {
    const data = await buildEod(store, day, s);
    const email = await deliverEod(data, status, s.eodEmailTo);
    await supabaseAdmin
      .from("daily_store_reports")
      .update({ status, data, generated_at: new Date().toISOString(), emailed_at: email.sent ? new Date().toISOString() : null, email_result: email, error: null })
      .eq("day", day)
      .eq("store", store);
    return `${store} ${day}: ${status}, e-mailed to ${email.sent}`;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from("daily_store_reports").update({ status: "failed", error: message }).eq("day", day).eq("store", store);
    return `${store} ${day}: failed — ${message}`;
  }
}

/** Provisional reports whose day now has a copy after closing: store figures made again, marked final. */
async function finaliseProvisional(s: PerformanceSettings) {
  const { data } = await supabaseAdmin.from("daily_store_reports").select("*").eq("status", "provisional").limit(20);
  const synced = s.lastSyncAt ? Date.parse(s.lastSyncAt) : 0;
  const notes: string[] = [];
  for (const row of (data ?? []) as EodRow[]) {
    if (synced < closingAt(s, row.store, row.day)) continue;
    const fresh = await buildEod(row.store, row.day, s);
    const old = row.data;
    // Team lines are only known on the day itself: keep the ones made then.
    const merged: EodData = { ...fresh, people: fresh.people ?? old?.people ?? null, noSales: fresh.noSales ?? old?.noSales ?? null, units: fresh.units ?? old?.units ?? null, teamAsAt: fresh.teamAsAt ?? old?.teamAsAt ?? null, monthNet: fresh.monthNet ?? old?.monthNet ?? null, monthTarget: fresh.monthTarget ?? old?.monthTarget ?? null, monthAchievement: fresh.monthAchievement ?? old?.monthAchievement ?? null, daysLeft: fresh.daysLeft ?? old?.daysLeft ?? null, stock: fresh.stock ?? old?.stock ?? null };
    if (merged.units !== null && merged.bills) merged.upb = merged.units / merged.bills;
    const changed = !old || Math.round(old.net) !== Math.round(merged.net) || old.bills !== merged.bills;
    const email = changed ? await deliverEod(merged, "final", s.eodEmailTo, true) : row.email_result;
    await supabaseAdmin
      .from("daily_store_reports")
      .update({ status: "final", data: merged, regenerated_at: new Date().toISOString(), email_result: email, emailed_at: changed && email?.sent ? new Date().toISOString() : row.emailed_at })
      .eq("day", row.day)
      .eq("store", row.store);
    notes.push(`${row.store} ${row.day}: final${changed ? " (figures changed, sent again)" : ""}`);
  }
  return notes;
}

/** Called every minute. */
export async function eodTick(at = new Date()): Promise<string> {
  const s = await loadPerformanceSettings();
  if (!s.eodOn) return "end-of-day reports off";
  if (g.__syEodBusy) return "already running";
  g.__syEodBusy = true;
  try {
    const now = istNow(at);
    const notes: string[] = [];
    const candidates = Object.keys(s.storeTargets).filter((st) => !s.excludedStores.includes(st) && !isSpecialDay(s, st, now.date));
    const due = candidates.filter((st) => at.getTime() >= closingAt(s, st, now.date));
    if (!due.length) {
      const fin = await finaliseProvisional(s);
      return fin.join("; ") || "nothing due";
    }
    const { data: storeRows } = await supabaseAdmin.from("daily_store_reports").select("store").eq("day", now.date);
    const done = new Set((storeRows ?? []).map((r) => String(r.store)));
    const stores = due.filter((st) => !done.has(st));
    for (const store of stores) {
      const closes = closingAt(s, store, now.date);
      if (at.getTime() < closes) continue;
      let synced = s.lastSyncAt ? Date.parse(s.lastSyncAt) : 0;
      if (synced < closes && (!g.__syEodSyncAt || Date.now() - g.__syEodSyncAt > 10 * 60_000)) {
        g.__syEodSyncAt = Date.now();
        await syncRecentSales().catch((e) => console.error("End-of-day copy failed:", e));
        const after = await loadPerformanceSettings();
        synced = after.lastSyncAt ? Date.parse(after.lastSyncAt) : 0;
        s.lastSyncAt = after.lastSyncAt;
      }
      if (synced >= closes) notes.push(await makeReport(store, now.date, "final", s));
      else if (now.minutes >= LATEST_PROVISIONAL) notes.push(await makeReport(store, now.date, "provisional", s));
    }
    notes.push(...(await finaliseProvisional(s)));
    return notes.join("; ") || "nothing due";
  } finally {
    g.__syEodBusy = false;
  }
}

/** Super Admin: make a day's report again (figures only; e-mailed again only when asked). */
export async function regenerateEod(store: string, day: string, email: boolean) {
  const s = await loadPerformanceSettings();
  const { data: row } = await supabaseAdmin.from("daily_store_reports").select("*").eq("day", day).eq("store", store).maybeSingle();
  const old = (row as EodRow | null)?.data ?? null;
  const fresh = await buildEod(store, day, s);
  const merged: EodData = { ...fresh, people: fresh.people ?? old?.people ?? null, noSales: fresh.noSales ?? old?.noSales ?? null, units: fresh.units ?? old?.units ?? null, teamAsAt: fresh.teamAsAt ?? old?.teamAsAt ?? null, monthNet: fresh.monthNet ?? old?.monthNet ?? null, monthTarget: fresh.monthTarget ?? old?.monthTarget ?? null, monthAchievement: fresh.monthAchievement ?? old?.monthAchievement ?? null, daysLeft: fresh.daysLeft ?? old?.daysLeft ?? null, stock: fresh.stock ?? old?.stock ?? null };
  const final = (s.lastSyncAt ? Date.parse(s.lastSyncAt) : 0) >= closingAt(s, store, day);
  const status = final ? "final" : "provisional";
  const emailResult = email ? await deliverEod(merged, status, s.eodEmailTo, Boolean(row)) : ((row as EodRow | null)?.email_result ?? null);
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("daily_store_reports").upsert({
    day,
    store,
    status,
    data: merged,
    generated_at: (row as EodRow | null)?.generated_at ?? now,
    regenerated_at: row ? now : null,
    emailed_at: email && emailResult?.sent ? now : ((row as EodRow | null)?.emailed_at ?? null),
    email_result: emailResult,
    error: null,
  });
  if (error) throw error;
  return { status, emailed: email ? (emailResult?.sent ?? 0) : 0 };
}

export async function loadEodReports(stores: string[] | "all", limit = 60): Promise<EodRow[]> {
  let q = supabaseAdmin.from("daily_store_reports").select("*").order("day", { ascending: false }).order("store").limit(limit);
  if (stores !== "all") q = q.in("store", stores.length ? stores : ["-"]);
  const { data } = await q;
  return (data ?? []) as EodRow[];
}
