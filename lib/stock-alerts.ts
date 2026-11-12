// Daily stock alert per store (server only): fast-moving items running low or out, and items out of stock
// that sold in the last 60 days. Sent once a day at the stock alert time (Settings, default 10:00 am),
// after the nightly stock read (11:30 pm), to the store's Store Manager / ASM and management:
// in-app alert + phone notification, and e-mail for the groups ticked.
// Once a day per store: the run is claimed first in performance_alert_runs (day + "stock-HH:MM"),
// so a second tick or server process cannot send it again. If stock was not read recently, the alert says so.

import { supabaseAdmin } from "@/lib/supabase/server";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { istNow, isSpecialDay } from "@/lib/business-day";
import { timeToMinutes, type AlertAudience, type PerformanceSettings } from "@/lib/performance-rules";
import { loadStockState, stockAlertsFor } from "@/lib/stock";
import { recipients, type Recipient } from "@/lib/eod-report";
import { sendEmail, siteUrl } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";

const SLOT_WINDOW = 25;
const LIST_MAX = 15;

export type StockAlertMessage = { store: string; title: string; summary: string; body: string; low: number; out: number };

const days = (x: number | null) => (x === null ? "—" : x < 1 ? "under 1 day" : `${Math.floor(x)} day(s)`);

/** Builds one store's alert, or null when nothing is low or out. */
export async function buildStockAlert(store: string, s: PerformanceSettings, at = new Date()): Promise<StockAlertMessage | null> {
  const [a, state] = await Promise.all([stockAlertsFor(store), loadStockState()]);
  if (!a.lowFast && !a.out.length) return null;
  const link = `${siteUrl()}/staff/performance/stock?store=${encodeURIComponent(store)}`;
  const lines: string[] = [];
  if (a.lowItems.length) {
    lines.push(`Fast-moving items running low or out (${a.lowItems.length}) — reorder today:`);
    for (const i of a.lowItems.slice(0, LIST_MAX)) {
      const reorder = Math.max(0, Math.ceil(i.perDay * s.reorderToDays - i.stock));
      lines.push(
        `  • ${i.name}${i.sku ? ` (${i.sku})` : ""}: stock ${i.stock}, sells ${i.perDay.toFixed(1)} a day, ${i.stock <= 0 ? "OUT" : `${days(i.coverDays)} left`} → reorder about ${reorder}`
      );
    }
    if (a.lowItems.length > LIST_MAX) lines.push(`  … and ${a.lowItems.length - LIST_MAX} more.`);
  }
  if (a.outItems.length) {
    lines.push("", `Out of stock that sold in the last 60 days: ${a.outItems.length} item(s). Best sellers among them:`);
    for (const i of a.outItems.slice(0, 5)) lines.push(`  • ${i.name}${i.sku ? ` (${i.sku})` : ""}: ${i.sold60} sold in 60 days`);
  }
  const readAt = state.lastAt ? new Date(state.lastAt) : null;
  const ageHours = readAt ? (at.getTime() - readAt.getTime()) / 3_600_000 : Infinity;
  if (ageHours > 36) {
    const when = readAt ? `${istNow(readAt).date}` : "never";
    lines.push("", `⚠ Stock was last read from Zoho POS on ${when}: figures may be out of date.`);
  }
  lines.push("", `Open: ${link}`);
  const summary = `${a.lowFast} fast mover(s) low or out · ${a.out.length} out of stock`;
  return { store, title: `${store} stock alert`, summary, body: lines.join("\n"), low: a.lowFast, out: a.out.length };
}

async function deliverStock(msg: StockAlertMessage, people: Recipient[], emailTo: AlertAudience[], tag: string) {
  const out = { people: people.length, inApp: 0, push: { devices: 0, sent: 0, failed: 0, error: null as string | null }, email: { sent: 0, failed: 0, skipped: 0 } };
  if (!people.length) return out;
  const { error } = await supabaseAdmin
    .from("staff_notifications")
    .insert(people.map((p) => ({ staff_id: p.id, ticket_type: null, ticket_id: null, ticket_number: null, title: msg.title, body: `${msg.summary}\n${msg.body}`.slice(0, 4000) })));
  if (!error) out.inApp = people.length;
  try {
    const r = await pushToStaff(
      people.map((p) => p.id),
      { title: msg.title, body: `${msg.summary}. Tap to see the items.`, url: `${siteUrl()}/staff/performance/stock?store=${encodeURIComponent(msg.store)}` }
    );
    out.push = { ...r, error: null };
  } catch (e) {
    out.push.error = e instanceof Error ? e.message : String(e);
  }
  for (const p of people) {
    if (!emailTo.includes(p.audience)) continue;
    if (!p.email || p.notify_email === false) {
      out.email.skipped++;
      continue;
    }
    const r = await sendEmail(p.email, `${msg.title}: ${msg.summary} — Seven Years`, `Hello ${p.full_name},\n\n${msg.summary}.\n\n${msg.body}\n\n— Seven Years Care`, { audience: "staff", ticketNumber: tag });
    if (r.ok) out.email.sent++;
    else if (/not set up/i.test(r.error ?? "")) out.email.skipped++;
    else out.email.failed++;
  }
  return out;
}

const g = globalThis as unknown as { __syStockAlertBusy?: boolean };

/** Called every minute. */
export async function stockAlertTick(at = new Date()): Promise<string> {
  const s = await loadPerformanceSettings();
  if (!s.stockAlertOn) return "stock alerts off";
  const now = istNow(at);
  const start = timeToMinutes(s.stockAlertTime);
  if (now.minutes < start || now.minutes >= start + SLOT_WINDOW) return "no slot due";
  if (g.__syStockAlertBusy) return "already running";
  g.__syStockAlertBusy = true;
  const slot = `stock-${s.stockAlertTime}`;
  try {
    const { error: claim } = await supabaseAdmin.from("performance_alert_runs").insert({ day: now.date, slot, status: "running" });
    if (claim) return /duplicate|23505/i.test(`${claim.code} ${claim.message}`) ? "already sent" : `could not claim: ${claim.message}`;
    const stores = Object.keys(s.storeTargets).filter((st) => !s.excludedStores.includes(st) && !isSpecialDay(s, st, now.date));
    const perStore: Record<string, unknown> = {};
    let recipientsTotal = 0;
    const total = { inApp: 0, push: { devices: 0, sent: 0, failed: 0, error: null as string | null }, email: { sent: 0, failed: 0, skipped: 0 } };
    let error: string | null = null;
    for (const store of stores) {
      try {
        const msg = await buildStockAlert(store, s, at);
        if (!msg) {
          perStore[store] = "nothing low";
          continue;
        }
        const people = await recipients(store);
        const d = await deliverStock(msg, people, s.stockAlertEmailTo, `STOCK ${now.date} ${store}`);
        perStore[store] = { low: msg.low, out: msg.out, people: d.people };
        recipientsTotal += d.people;
        total.inApp += d.inApp;
        total.push.devices += d.push.devices;
        total.push.sent += d.push.sent;
        total.push.failed += d.push.failed;
        total.push.error ??= d.push.error;
        total.email.sent += d.email.sent;
        total.email.failed += d.email.failed;
        total.email.skipped += d.email.skipped;
      } catch (e) {
        error = `${store}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const result = { slot, stale: false, lastSyncAt: null, recipients: recipientsTotal, ...total, error, stores: perStore };
    await supabaseAdmin.from("performance_alert_runs").update({ finished_at: new Date().toISOString(), status: error ? "failed" : "sent", result }).eq("day", now.date).eq("slot", slot);
    return `stock alert: ${recipientsTotal} recipient(s)${error ? ` — ${error}` : ""}`;
  } finally {
    g.__syStockAlertBusy = false;
  }
}

/** Super Admin test: the alert of each store, sent only to the person pressing the button. */
export async function sendTestStockAlert(me: { id: string; full_name: string; email: string | null }) {
  const s = await loadPerformanceSettings();
  const stores = Object.keys(s.storeTargets).filter((st) => !s.excludedStores.includes(st));
  const out: { store: string; summary: string; preview: string; wouldReach: number; delivered: Awaited<ReturnType<typeof deliverStock>> | null }[] = [];
  for (const store of stores) {
    const msg = await buildStockAlert(store, s);
    if (!msg) {
      out.push({ store, summary: "Nothing low or out — no alert would be sent.", preview: "", wouldReach: 0, delivered: null });
      continue;
    }
    const people = await recipients(store);
    const me1: Recipient = { id: me.id, full_name: me.full_name, email: me.email, notify_email: true, audience: "management" };
    const delivered = await deliverStock({ ...msg, title: `TEST · ${msg.title}` }, [me1], ["staff", "sm", "management"], `STOCK TEST ${store}`);
    out.push({ store, summary: msg.summary, preview: msg.body, wouldReach: people.length, delivered });
  }
  return out;
}
