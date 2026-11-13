// Sales update alerts at the alert times (Settings → Business day, e.g. 11:00, 14:00, 17:00, 20:00 India time).
// Server only. Each time slot is sent once a day: the run is first "claimed" in performance_alert_runs
// (primary key day + slot), so a second server process or a second tick cannot send it again.
//
// Before sending, sales are copied from Zoho POS if the last copy is older than 25 minutes. If the copy
// still fails, the alert says how old the figures are ("stale") instead of pretending they are live.
//
// Who gets what (Settings → Sales alerts):
//   staff       — own sales today, what is needed today, month so far vs own target
//   sm          — own store today, needed today, month so far, top sellers today, people with no bills yet
//   management  — every store they look after (Directors: their stores) and the total
// Every recipient gets an in-app alert and a phone / browser notification (where switched on);
// the audiences in "alertEmailTo" also get an e-mail (only staff with e-mail alerts on).

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { loadStaffForPerformance, monthReport, type StoreReport } from "@/lib/performance";
import { hoursOf, istNow } from "@/lib/business-day";
import { timeToMinutes, type AlertAudience, type PerformanceSettings } from "@/lib/performance-rules";
import { isAdmin, asRole } from "@/lib/roles";
import { sendEmail, siteUrl } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";
import { syncRecentSales } from "@/lib/sales-sync";
import { clock, storeReportLines } from "@/lib/report-format";
import { parseReport, reportHtml } from "@/lib/report-parse";
import { loadWalkinsMany, type Walkins } from "@/lib/walkins";

/** Minutes after a slot during which it may still be sent (late server start, busy tick). */
const SLOT_WINDOW = 25;
/** Figures older than this are marked as not up to date. */
const STALE_MINUTES = 45;

export type AlertMessage = { audience: AlertAudience; staffId: string; name: string; email: string | null; emailOn: boolean; title: string; body: string; summary: string };

export type AlertRunResult = {
  slot: string;
  stale: boolean;
  lastSyncAt: string | null;
  recipients: number;
  inApp: number;
  push: { devices: number; sent: number; failed: number; error: string | null };
  email: { sent: number; failed: number; skipped: number };
  error: string | null;
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const first2 = (name: string) => name.split(" ").slice(0, 2).join(" ");

/** Today's share of what is left of a target (same rule as the dashboard). */
function neededToday(target: number, monthNet: number, todayNet: number, daysLeftAfterToday: number) {
  return target > 0 ? Math.max(0, (target - (monthNet - todayNet)) / Math.max(1, daysLeftAfterToday + 1)) : 0;
}

/** Share of the trading day gone (0–1) for a store, by its opening hours. */
function dayGone(s: PerformanceSettings, store: string, minutes: number) {
  const h = hoursOf(s, store);
  const open = timeToMinutes(h.open);
  const close = timeToMinutes(h.close);
  if (close <= open) return 1;
  return Math.min(1, Math.max(0, (minutes - open) / (close - open)));
}

function storeLines(st: StoreReport, s: PerformanceSettings, minutes: number, day: string, when: string, walkins: number | null, walkinsAt: string | null = null) {
  const daysLeft = Math.max(0, st.daysInMonth - st.daysGone);
  const need = neededToday(st.target, st.net, st.today.net, daysLeft);
  const gone = dayGone(s, st.store, minutes);
  const paceShort = need > 0 && gone > 0 && gone < 1 ? Math.max(0, need * gone - st.today.net) : null;
  const lines = storeReportLines({
    store: st.store,
    day,
    when,
    closing: false,
    monthTarget: st.target,
    daysInMonth: st.daysInMonth,
    dayOfMonth: st.daysGone,
    net: st.today.net,
    bills: st.today.bills,
    mtd: st.net,
    paceShort,
    walkins,
    walkinsAt,
  });
  const summary = `${st.store}: ${rupees(st.today.net)} from ${st.today.bills} bill(s)${st.target > 0 ? ` · MTD ${pct(st.net / st.target)}` : ""}${paceShort ? ` · behind by ${rupees(paceShort)}` : ""}`;
  return { lines, need, summary };
}

/** Builds every message for this moment. Nothing is sent here. */
export async function buildSalesAlerts(at = new Date(), slotTime?: string): Promise<{ messages: AlertMessage[]; stale: boolean; lastSyncAt: string | null; slotLabel: string }> {
  const s = await loadPerformanceSettings();
  const now = istNow(at);
  const month = now.date.slice(0, 7);
  const report = await monthReport(month, true);
  const lastSyncAt = report.settings.lastSyncAt ?? s.lastSyncAt ?? null;
  const ageMin = lastSyncAt ? (at.getTime() - Date.parse(lastSyncAt)) / 60_000 : Infinity;
  const stale = ageMin > STALE_MINUTES;
  const slotLabel = clock(slotTime ? timeToMinutes(slotTime) : now.minutes);
  const synced = lastSyncAt ? istNow(new Date(lastSyncAt)) : null;
  const staleLine = stale
    ? `⚠ Figures are not up to date — last copy from Zoho POS ${synced ? `at ${clock(synced.minutes)}${synced.date !== now.date ? ` on ${synced.date}` : ""}` : "not done yet"}.`
    : "";
  const link = `${siteUrl()}/staff/performance`;
  const tail = [staleLine, "Provisional — today is not closed yet.", `Open: ${link}`].filter(Boolean);

  const { data: staffRows } = await supabaseAdmin
    .from("staff_users")
    .select("id, full_name, role, store_name, email, notify_email, director_stores, incentive_group")
    .eq("is_active", true);
  const staff = (staffRows ?? []) as {
    id: string;
    full_name: string;
    role: string;
    store_name: string | null;
    email: string | null;
    notify_email: boolean | null;
    director_stores: string[] | null;
    incentive_group: string | null;
  }[];

  const stores = report.stores.filter((st) => !s.excludedStores.includes(st.store));
  const walkins = await loadWalkinsMany(
    stores.map((st) => st.store),
    now.date
  ).catch(() => new Map<string, Walkins>());
  const block = (st: StoreReport) => {
    const w = walkins.get(st.store);
    return storeLines(st, s, now.minutes, now.date, slotLabel, w?.count ?? null, w ? clock(istNow(new Date(w.updated_at)).minutes) : null);
  };
  const messages: AlertMessage[] = [];
  const sent = new Set<string>();
  const add = (audience: AlertAudience, r: (typeof staff)[number], title: string, body: string[], summary?: string) => {
    if (sent.has(r.id)) return;
    sent.add(r.id);
    messages.push({ audience, staffId: r.id, name: r.full_name, email: r.email, emailOn: r.notify_email !== false, title, body: [...body, ...tail].join("\n"), summary: summary ?? body[0] ?? title });
  };

  // Management: every store they look after.
  if (s.alertTo.includes("management")) {
    for (const r of staff) {
      const role = asRole(r.role);
      let list: StoreReport[] = [];
      if (isAdmin(role) || role === "operations_manager") list = stores;
      else if (role === "director") {
        const mine = (r.director_stores ?? []).map((x) => x.toUpperCase());
        list = mine.length ? stores.filter((st) => mine.includes(st.store)) : stores;
      } else continue;
      if (!list.length) continue;
      const body: string[] = [];
      const sums: string[] = [];
      for (const st of list) {
        const b = block(st);
        body.push(...b.lines, "");
        sums.push(b.summary);
      }
      if (list.length > 1) {
        const total = list.reduce((a, st) => a + st.today.net, 0);
        const bills = list.reduce((a, st) => a + st.today.bills, 0);
        body.push(`All stores: ${rupees(total)} today from ${bills} bill(s).`);
      }
      add("management", r, `Sales update ${slotLabel}`, body, sums.join(" | "));
    }
  }

  // Store Managers / ASM: their own store and team.
  if (s.alertTo.includes("sm")) {
    for (const st of stores) {
      const leaders = st.people.filter((p) => p.staffId && (p.group === "sm" || p.group === "asm"));
      const smIds = new Set(leaders.map((p) => p.staffId!));
      for (const r of staff) if (asRole(r.role) === "store_manager" && (r.store_name ?? "").toUpperCase() === st.store) smIds.add(r.id);
      if (!smIds.size) continue;
      const { lines, summary } = block(st);
      const sellers = st.people.filter((p) => p.targetApplies && !p.poolOnly);
      const top = [...sellers].filter((p) => p.today.net > 0).sort((a, b) => b.today.net - a.today.net).slice(0, 3);
      const none = sellers.filter((p) => p.today.bills === 0);
      const body = [...lines];
      if (top.length) body.push(`Top today: ${top.map((p) => `${first2(p.name)} ${rupees(p.today.net)}`).join(", ")}.`);
      if (none.length && dayGone(s, st.store, now.minutes) > 0.2)
        body.push(`No bills yet today (if on duty): ${none.slice(0, 8).map((p) => first2(p.name)).join(", ")}${none.length > 8 ? ` and ${none.length - 8} more` : ""}.`);
      for (const id of smIds) {
        const r = staff.find((x) => x.id === id);
        if (r) add("sm", r, `${st.store} sales ${slotLabel}`, body, summary);
      }
    }
  }

  // Sales staff: own figures.
  if (s.alertTo.includes("staff")) {
    for (const st of stores) {
      const daysLeft = Math.max(0, st.daysInMonth - st.daysGone);
      for (const p of st.people) {
        if (!p.staffId || !p.targetApplies || p.poolOnly || p.group === "sm" || p.group === "asm") continue;
        const r = staff.find((x) => x.id === p.staffId);
        if (!r) continue;
        const target = p.target ?? 0;
        const need = neededToday(target, p.net, p.today.net, daysLeft);
        const body = [`Your sales today: ${rupees(p.today.net)} from ${p.today.bills} bill(s)${need > 0 ? ` — ${pct(p.today.net / need)} of the ${rupees(need)} needed today` : ""}.`];
        if (target > 0) body.push(`Month so far ${rupees(p.net)} of your ${rupees(target)} target (${pct(p.net / target)}).`);
        body.push(`Store today: ${rupees(st.today.net)}.`);
        add("staff", r, `Your sales ${slotLabel}`, body);
      }
    }
  }

  // CREs: a reminder to post the walk-ins so far (added to their own update, or on its own).
  const perfStaff = await loadStaffForPerformance(s.asmIsFm).catch(() => []);
  for (const c of perfStaff) {
    if (c.group !== "cashier_cre" || !c.store || !stores.some((st) => st.store === c.store)) continue;
    const w = walkins.get(c.store);
    const line = w
      ? `Walk-ins posted so far: ${w.count} (at ${clock(istNow(new Date(w.updated_at)).minutes)}). Update the total now: ${link}`
      : `Walk-ins are not posted yet for ${c.store} today — post the total so far now: ${link}`;
    const mine = messages.find((m) => m.staffId === c.id);
    if (mine) mine.body = `${line}\n\n${mine.body}`;
    else {
      const r = staff.find((x) => x.id === c.id);
      if (r) {
        sent.add(r.id);
        messages.push({ audience: "staff", staffId: r.id, name: r.full_name, email: r.email, emailOn: r.notify_email !== false, title: `Walk-ins ${slotLabel} · ${c.store}`, body: line, summary: line.split(":")[0] });
      }
    }
  }

  return { messages, stale, lastSyncAt, slotLabel };
}

/** Sends the messages: in-app alert + phone notification for everyone, e-mail for the chosen audiences. */
async function deliver(messages: AlertMessage[], emailTo: AlertAudience[], meta: { slot: string }) {
  const out = { inApp: 0, push: { devices: 0, sent: 0, failed: 0, error: null as string | null }, email: { sent: 0, failed: 0, skipped: 0 } };
  if (!messages.length) return out;
  const { error } = await supabaseAdmin.from("staff_notifications").insert(
    messages.map((m) => ({ staff_id: m.staffId, ticket_type: null, ticket_id: null, ticket_number: null, title: m.title, body: m.body }))
  );
  if (!error) out.inApp = messages.length;
  else console.error("Sales alert in-app insert failed:", error);

  // One phone notification per person (their first line is the summary).
  for (const m of messages) {
    try {
      const r = await pushToStaff([m.staffId], { title: m.title, body: m.summary.slice(0, 180), url: `${siteUrl()}/staff/performance` });
      out.push.devices += r.devices;
      out.push.sent += r.sent;
      out.push.failed += r.failed;
    } catch (e) {
      out.push.error = e instanceof Error ? e.message : String(e);
      break; // not set up: no point trying the rest
    }
  }

  for (const m of messages) {
    if (!emailTo.includes(m.audience)) continue;
    if (!m.email || !m.emailOn) {
      out.email.skipped++;
      continue;
    }
    const segs = parseReport(m.body);
    const r = await sendEmail(
      m.email,
      `${m.title} — Seven Years`,
      `Hello ${m.name},\n\n${m.body}\n\n— Seven Years Care`,
      { audience: "staff", ticketNumber: `ALERT ${meta.slot}` },
      segs ? reportHtml(segs, `Hello ${m.name},`) : undefined
    );
    if (r.ok) out.email.sent++;
    else if (/not set up/i.test(r.error ?? "")) out.email.skipped++;
    else out.email.failed++;
  }
  return out;
}

const g = globalThis as unknown as { __syAlertBusy?: boolean; __syEodBusy?: boolean };

/** Called every minute. Sends the slot that is due (once a day per slot). */
export async function alertTick(at = new Date()): Promise<string> {
  const s = await loadPerformanceSettings();
  if (!s.alertsOn) return "alerts off";
  const now = istNow(at);
  const slot = s.alertTimes.find((t) => now.minutes >= timeToMinutes(t) && now.minutes < timeToMinutes(t) + SLOT_WINDOW);
  if (!slot) return "no slot due";
  if (g.__syAlertBusy) return "already running";
  g.__syAlertBusy = true;
  try {
    // Claim the slot. A second process / tick gets a duplicate-key error and stops here.
    const { error: claimError } = await supabaseAdmin.from("performance_alert_runs").insert({ day: now.date, slot, started_at: new Date().toISOString(), status: "running" });
    if (claimError) return /duplicate|23505/i.test(`${claimError.code} ${claimError.message}`) ? "already sent" : `could not claim: ${claimError.message}`;
    const result = await runAlerts(slot, s);
    await supabaseAdmin
      .from("performance_alert_runs")
      .update({ finished_at: new Date().toISOString(), status: result.error ? "failed" : "sent", stale: result.stale, last_sync_at: result.lastSyncAt, result })
      .eq("day", now.date)
      .eq("slot", slot);
    return `slot ${slot}: ${result.recipients} recipient(s)${result.stale ? " (stale)" : ""}${result.error ? ` — ${result.error}` : ""}`;
  } finally {
    g.__syAlertBusy = false;
  }
}

async function freshen(s: PerformanceSettings) {
  const age = s.lastSyncAt ? (Date.now() - Date.parse(s.lastSyncAt)) / 60_000 : Infinity;
  if (age > 25) await syncRecentSales().catch((e) => console.error("Alert pre-copy failed:", e));
}

async function runAlerts(slot: string, s: PerformanceSettings): Promise<AlertRunResult> {
  const base: AlertRunResult = { slot, stale: false, lastSyncAt: null, recipients: 0, inApp: 0, push: { devices: 0, sent: 0, failed: 0, error: null }, email: { sent: 0, failed: 0, skipped: 0 }, error: null };
  try {
    await freshen(s);
    const built = await buildSalesAlerts(new Date(), slot);
    const d = await deliver(built.messages, s.alertEmailTo, { slot });
    return { ...base, stale: built.stale, lastSyncAt: built.lastSyncAt, recipients: built.messages.length, ...d };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Super Admin test: builds the alerts now and sends only the chosen person's own copy (or a sample) to that person. */
export async function sendTestAlert(me: { id: string; full_name: string; email: string | null }) {
  const s = await loadPerformanceSettings();
  await freshen(s);
  const built = await buildSalesAlerts();
  const mine = built.messages.find((m) => m.staffId === me.id);
  const sample = mine ?? built.messages.find((m) => m.audience === "management") ?? built.messages[0];
  if (!sample) return { ok: false as const, error: "No one would get an alert now (check who gets them, and that stores have sales data)." };
  const msg: AlertMessage = { ...sample, staffId: me.id, name: me.full_name, email: me.email, emailOn: true, title: `TEST · ${sample.title}` };
  const d = await deliver([msg], ["staff", "sm", "management"], { slot: "test" });
  const byAudience = { staff: 0, sm: 0, management: 0 } as Record<AlertAudience, number>;
  for (const m of built.messages) byAudience[m.audience]++;
  return { ok: true as const, delivered: d, stale: built.stale, lastSyncAt: built.lastSyncAt, wouldReach: byAudience, preview: msg.body, title: msg.title };
}

export type AlertRunRow = { day: string; slot: string; started_at: string; finished_at: string | null; status: string; stale: boolean | null; last_sync_at: string | null; result: AlertRunResult | null };

export async function loadAlertRuns(limit = 40): Promise<AlertRunRow[]> {
  const { data } = await supabaseAdmin.from("performance_alert_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  return (data ?? []) as AlertRunRow[];
}
