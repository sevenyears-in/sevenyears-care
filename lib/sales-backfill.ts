// Night copy of earlier months from Zoho POS (server only).
//
// Runs only between 11:30 pm and 11:59 pm (India time), when the day's Zoho quota is
// otherwise unused. Lists are read 200 records at a time; each bill and return is then read
// once. It keeps under 75 reads a minute (Zoho allows 100 for all APIs together) and stops
// before the daily quota. Months already complete are skipped; the current month is copied
// by the normal 30-minute sync.

import { supabaseAdmin } from "@/lib/supabase/server";
import { flushZohoUsage, zohoCallsLastMinute, zohoCallsMade, zohoCallsToday, zohoConfigured, zohoRead } from "@/lib/zoho";
import { todayISO } from "@/lib/helpers";
import { assignPtCodes, saveCreditNote, saveInvoice, SKIP_STATUS } from "@/lib/sales-sync";

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

export const BACKFILL_KEY = "sales_backfill";
const START = 23 * 60 + 30; // 11:30 pm
const STOP = 23 * 60 + 58; // stop starting new reads at 11:58 pm
const MAX_PER_MINUTE = 75;
const RESERVE = 250; // reads kept back for the rest of the day

export type BackfillNight = {
  day: string;
  startedAt: string;
  endedAt: string | null;
  reads: number;
  bills: number;
  returns: number;
  months: string[];
  note: string | null;
};

export type BackfillState = {
  /** Copy earlier months at night. */
  on: boolean;
  /** Earliest month to copy (YYYY-MM). */
  fromMonth: string;
  /** Zoho POS daily request quota of the plan. */
  dailyQuota: number;
  /** Months fully copied. */
  doneMonths: string[];
  /** Month being copied and how far it is. */
  progress: { month: string; bills: number; billsSaved: number; returns: number; returnsSaved: number } | null;
  lastNight: BackfillNight | null;
  heartbeat: string | null;
};

const monthOf = (d: string) => d.slice(0, 7);
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};
/** Financial year start (April) of a day. */
const fyStart = (d: string) => {
  const y = Number(d.slice(0, 4));
  return `${Number(d.slice(5, 7)) >= 4 ? y : y - 1}-04`;
};

export const istMinutes = (at = new Date()) => {
  const t = new Date(at.getTime() + 5.5 * 3_600_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
export const inNightWindow = (at = new Date()) => {
  const m = istMinutes(at);
  return m >= START && m < STOP;
};

export async function loadBackfill(): Promise<BackfillState> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", BACKFILL_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<BackfillState>;
  return {
    on: v.on === undefined ? true : Boolean(v.on),
    fromMonth: /^\d{4}-\d{2}$/.test(String(v.fromMonth)) ? String(v.fromMonth) : fyStart(todayISO()),
    dailyQuota: Number(v.dailyQuota) > 0 ? Number(v.dailyQuota) : 7500,
    doneMonths: Array.isArray(v.doneMonths) ? v.doneMonths.map(String) : [],
    progress: v.progress ?? null,
    lastNight: v.lastNight ?? null,
    heartbeat: v.heartbeat ?? null,
  };
}

export async function saveBackfill(change: Partial<BackfillState>) {
  const current = await loadBackfill();
  const value = { ...current, ...change };
  await supabaseAdmin.from("app_settings").upsert({ key: BACKFILL_KEY, value, updated_at: new Date().toISOString() });
  return value;
}

/** Earlier months still to copy, newest first. */
export function monthsToCopy(s: BackfillState, today = todayISO()) {
  const out: string[] = [];
  for (let m = shiftMonth(monthOf(today), -1); m >= s.fromMonth && out.length < 36; m = shiftMonth(m, -1)) {
    if (!s.doneMonths.includes(m)) out.push(m);
  }
  return out;
}

async function listMonth(path: "invoices" | "creditnotes", key: string, month: string) {
  const from = `${month}-01`;
  const to = lastDay(month);
  const out: Obj[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await zohoRead(path, { date_start: from, date_end: to, per_page: "200", page: String(page) });
    out.push(...arr(res[key]));
    if (!obj(res.page_context).has_more_page) break;
  }
  return out.filter((r) => str(r.date) >= from && str(r.date) <= to && !SKIP_STATUS.has(str(r.status).toLowerCase()));
}

async function savedIds(table: "sales_invoices" | "sales_returns", idCol: string, dateCol: string, month: string) {
  const map = new Map<string, string | null>();
  for (let start = 0; start < 50_000; start += 1000) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(`${idCol}, modified_at`)
      .gte(dateCol, `${month}-01`)
      .lte(dateCol, lastDay(month))
      .order(idCol)
      .range(start, start + 999);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as Obj[]) map.set(str(r[idCol]), (r.modified_at as string | null) ?? null);
    if (!data || data.length < 1000) break;
  }
  return map;
}

let running = false;

/**
 * One night's run. Returns what it did, or why it did not run.
 * Safe to call often: it runs only in the night window, once at a time.
 */
export async function runNightBackfill(): Promise<string> {
  if (running) return "already running";
  if (!inNightWindow()) return "outside 11:30–11:59 pm";
  running = true;
  try {
    if (!(await zohoConfigured())) return "Zoho POS is not connected";
    let state = await loadBackfill();
    if (!state.on) return "switched off";
    // Another server already working on it (heartbeat in the last 2 minutes)?
    if (state.heartbeat && Date.now() - Date.parse(state.heartbeat) < 120_000) return "running elsewhere";
    const months = monthsToCopy(state);
    if (!months.length) return "nothing to copy";

    const day = todayISO();
    const usedBefore = await zohoCallsToday();
    const budget = state.dailyQuota - usedBefore - RESERVE;
    const night: BackfillNight =
      state.lastNight?.day === day
        ? { ...state.lastNight, endedAt: null }
        : { day, startedAt: new Date().toISOString(), endedAt: null, reads: 0, bills: 0, returns: 0, months: [], note: null };
    if (budget <= 20) {
      night.note = `Zoho daily quota nearly used (${usedBefore.toLocaleString("en-IN")} of ${state.dailyQuota.toLocaleString("en-IN")}).`;
      night.endedAt = new Date().toISOString();
      await saveBackfill({ lastNight: night });
      return night.note;
    }

    const startCount = zohoCallsMade();
    const used = () => zohoCallsMade() - startCount;
    const canGo = () => inNightWindow() && used() < budget - 5;
    const pace = async () => {
      while (zohoCallsLastMinute() >= MAX_PER_MINUTE) await new Promise((r) => setTimeout(r, 2000));
    };
    let lastBeat = 0;
    const beat = async (progress: BackfillState["progress"]) => {
      if (Date.now() - lastBeat < 20_000) return;
      lastBeat = Date.now();
      state = await saveBackfill({ heartbeat: new Date().toISOString(), progress, lastNight: { ...night, reads: night.reads + used() } });
    };

    let returnsBlocked = false;
    for (const month of months) {
      if (!canGo()) break;
      if (!night.months.includes(month)) night.months.push(month);
      await pace();
      const bills = await listMonth("invoices", "invoices", month);
      const savedBills = await savedIds("sales_invoices", "invoice_id", "invoice_date", month);
      const links = await assignPtCodes(bills.map((r) => str(r.salesperson_name)));
      const billTodo = bills.filter((r) => {
        const id = str(r.invoice_id);
        return !savedBills.has(id) || (str(r.last_modified_time) && savedBills.get(id) !== str(r.last_modified_time));
      });
      const progress = { month, bills: bills.length, billsSaved: bills.length - billTodo.length, returns: 0, returnsSaved: 0 };
      let billsLeft = billTodo.length;
      for (const row of billTodo) {
        if (!canGo()) break;
        await pace();
        try {
          await saveInvoice(row, links);
          night.bills++;
          progress.billsSaved++;
          billsLeft--;
        } catch (error) {
          console.error("Night copy: bill failed", str(row.invoice_number), error);
        }
        await beat(progress);
      }

      let returnsLeft = 0;
      if (canGo() && !returnsBlocked) {
        try {
          await pace();
          const cns = await listMonth("creditnotes", "creditnotes", month);
          const savedCns = await savedIds("sales_returns", "creditnote_id", "return_date", month);
          const cnTodo = cns.filter((r) => {
            const id = str(r.creditnote_id);
            return !savedCns.has(id) || (str(r.last_modified_time) && savedCns.get(id) !== str(r.last_modified_time));
          });
          progress.returns = cns.length;
          progress.returnsSaved = cns.length - cnTodo.length;
          returnsLeft = cnTodo.length;
          for (const row of cnTodo) {
            if (!canGo()) break;
            await pace();
            try {
              await saveCreditNote(row, links);
              night.returns++;
              progress.returnsSaved++;
              returnsLeft--;
            } catch (error) {
              console.error("Night copy: return failed", str(row.creditnote_number), error);
            }
            await beat(progress);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (/not authori[sz]ed/i.test(msg)) {
            returnsBlocked = true;
            night.note = "Returns (credit notes) could not be read — reconnect Zoho POS so returns are copied too.";
          } else {
            returnsLeft = 1; // try the month again next night
            night.note = `Returns: ${msg}`;
          }
        }
      } else if (!canGo()) {
        returnsLeft = 1;
      }

      if (billsLeft === 0 && returnsLeft === 0) {
        state = await saveBackfill({ doneMonths: [...new Set([...state.doneMonths, month])].sort(), progress: null });
      } else {
        state = await saveBackfill({ progress });
        // Out of time or reads: carry on tomorrow night. A bill that would not read: go on to the next month.
        if (!canGo()) break;
      }
    }

    night.reads += used();
    night.endedAt = new Date().toISOString();
    await saveBackfill({ lastNight: night, heartbeat: null });
    await flushZohoUsage().catch(() => undefined);
    return `copied ${night.bills} bill(s) and ${night.returns} return(s) with ${used()} read(s)`;
  } catch (error) {
    console.error("Night copy failed:", error);
    await saveBackfill({ heartbeat: null }).catch(() => undefined);
    await flushZohoUsage().catch(() => undefined);
    return "failed";
  } finally {
    running = false;
  }
}
