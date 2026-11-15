// Store opening and closing from the biometric devices (server only).
// Each store has its own punching machine. The first punch of the day opens the store
// (opening time = first punch − 2 minutes); the last punch closes it. "Store Opened" and
// "Store Closed" go to the store's Store Manager / ASM and management (app + phone).
//
// Closing: staff leaving early punch out in the evening, the closers punch around or after
// closing time. Once a closer has punched and the machine has been quiet for 45 minutes (and
// the office PC is still sending punches), the last punch is the closing. If no one punches
// near closing time, the store closed early: 2 hours after closing time the last punch counts.

import { supabaseAdmin } from "@/lib/supabase/server";
import { istNow } from "@/lib/business-day";
import { attendanceCode, attendanceSettings } from "@/lib/attendance";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { timeToMinutes } from "@/lib/performance-rules";
import { CORPORATE_OFFICE } from "@/lib/stores";
import { siteUrl } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";

const DEVICES_KEY = "store_devices";
/** Opening shown this many minutes before the first punch. */
const OPEN_EARLY_MIN = 2;
/** Machine quiet this long after the closers' punch → the last punch is the closing. */
const QUIET_MIN = 45;
/** Closers punch out from this long before closing time; earlier punches are staff leaving early. */
const CLOSERS_FROM_MIN = 5;
/** No closer by this long after closing time → the store closed early: the last punch is the closing. */
const EARLY_CLOSE_WAIT_MIN = 120;
/** Punches before this time (India) do not open the store. */
const EARLIEST_OPEN = 5 * 60;
/** Notices are only sent when found this soon (no old "opened" notices after an outage). */
const NOTIFY_WITHIN_MIN = 60;
const NOTIFY_CLOSE_WITHIN_MIN = 180;

export type OpenClose = { day: string; store: string; openedAt: string | null; closedAt: string | null; firstPunch: string | null; lastPunch: string | null };

const g = globalThis as unknown as { __syOpenCloseBusy?: boolean };

const dayStartUtc = (day: string) => Date.parse(`${day}T00:00:00Z`) - 5.5 * 3_600_000;
const shiftDay = (day: string, add: number) => new Date(Date.parse(`${day}T00:00:00Z`) + add * 86_400_000).toISOString().slice(0, 10);
export const clockIST = (iso: string | number) => {
  const t = new Date(typeof iso === "number" ? iso : Date.parse(iso));
  const m = Math.round((t.getTime() + 5.5 * 3_600_000) / 60_000) % 1440;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

// ------------------------------------------------------------------
// Which machine is in which store
// ------------------------------------------------------------------

/** Device → store. Found from the staff who punch on each machine (their store), and kept. */
export async function deviceStores(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", DEVICES_KEY).maybeSingle();
  const saved = ((data?.value as { map?: Record<string, string> } | null)?.map ?? {}) as Record<string, string>;

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: punches } = await supabaseAdmin.from("attendance_punches").select("device, emp_code").gte("punch_time", since).not("device", "is", null).limit(20000);
  const devices = new Set(((punches ?? []) as { device: string }[]).map((p) => String(p.device)));
  const missing = [...devices].filter((d) => !saved[d]);
  if (!missing.length) return saved;

  const { data: staff } = await supabaseAdmin.from("staff_users").select("user_id, store_name");
  const storeOf = new Map(((staff ?? []) as { user_id: string; store_name: string | null }[]).map((s) => [attendanceCode(s.user_id), String(s.store_name ?? "").toUpperCase()]));
  const found: Record<string, string> = {};
  for (const d of missing) {
    const votes = new Map<string, number>();
    for (const p of (punches ?? []) as { device: string; emp_code: string }[]) {
      if (String(p.device) !== d) continue;
      const st = storeOf.get(attendanceCode(p.emp_code));
      if (!st || st === CORPORATE_OFFICE.toUpperCase()) continue;
      votes.set(st, (votes.get(st) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 5) found[d] = best[0];
  }
  if (!Object.keys(found).length) return saved;
  const map = { ...saved, ...found };
  await supabaseAdmin.from("app_settings").upsert({ key: DEVICES_KEY, value: { map }, updated_at: new Date().toISOString() });
  return map;
}

// ------------------------------------------------------------------
// Reading
// ------------------------------------------------------------------

export async function loadOpenClose(store: string, day: string): Promise<OpenClose | null> {
  const { data } = await supabaseAdmin.from("store_open_close").select("day, store, opened_at, closed_at, first_punch, last_punch").eq("store", store).eq("day", day).maybeSingle();
  if (!data) return null;
  return { day: data.day, store: data.store, openedAt: data.opened_at, closedAt: data.closed_at, firstPunch: data.first_punch, lastPunch: data.last_punch };
}

// ------------------------------------------------------------------
// Every minute
// ------------------------------------------------------------------

async function recipientsOf(store: string) {
  const { recipients } = await import("@/lib/eod-report");
  return recipients(store);
}

async function notify(store: string, title: string, body: string) {
  const people = await recipientsOf(store);
  if (!people.length) return 0;
  await supabaseAdmin.from("staff_notifications").insert(people.map((p) => ({ staff_id: p.id, ticket_type: null, ticket_id: null, ticket_number: null, title, body })));
  await pushToStaff(
    people.map((p) => p.id),
    { title, body, url: `${siteUrl()}/staff/performance?view=team&store=${encodeURIComponent(store)}` }
  ).catch((e) => console.error("Open/close push failed:", e));
  return people.length;
}

type Row = { day: string; store: string; first_punch: string | null; opened_notified_at: string | null; last_punch: string | null; closed_notified_at: string | null };

export async function openCloseTick(at = new Date()): Promise<string> {
  if (g.__syOpenCloseBusy) return "already running";
  g.__syOpenCloseBusy = true;
  try {
    const now = istNow(at);
    // Just after midnight, yesterday's closing may still be waiting.
    const days = now.minutes < 120 ? [shiftDay(now.date, -1), now.date] : [now.date];
    const devices = await deviceStores();
    if (!Object.keys(devices).length) return "no store devices yet";
    const [settings, att] = await Promise.all([loadPerformanceSettings(), attendanceSettings()]);
    const syncFresh = att.lastSyncAt ? at.getTime() - Date.parse(att.lastSyncAt) < 6 * 60_000 : false;
    const notes: string[] = [];

    for (const day of days) {
      const from = new Date(dayStartUtc(day) + EARLIEST_OPEN * 60_000).toISOString();
      const to = new Date(dayStartUtc(day) + 86_400_000).toISOString();
      const { data: punches } = await supabaseAdmin
        .from("attendance_punches")
        .select("device, punch_time")
        .gte("punch_time", from)
        .lt("punch_time", to)
        .not("device", "is", null)
        .order("punch_time")
        .limit(5000);
      const byStore = new Map<string, { device: string; first: string; last: string }>();
      for (const p of (punches ?? []) as { device: string; punch_time: string }[]) {
        const store = devices[String(p.device)];
        if (!store) continue;
        const cur = byStore.get(store);
        if (!cur) byStore.set(store, { device: String(p.device), first: p.punch_time, last: p.punch_time });
        else cur.last = p.punch_time;
      }
      if (!byStore.size) continue;

      const { data: existing } = await supabaseAdmin.from("store_open_close").select("day, store, first_punch, opened_notified_at, last_punch, closed_notified_at").eq("day", day);
      const rows = new Map(((existing ?? []) as Row[]).map((r) => [r.store, r]));

      for (const [store, p] of byStore) {
        const row = rows.get(store);
        const firstMs = Date.parse(p.first);
        const lastMs = Date.parse(p.last);

        // Opening.
        if (!row) {
          await supabaseAdmin.from("store_open_close").upsert(
            { day, store, device: p.device, first_punch: p.first, opened_at: new Date(firstMs - OPEN_EARLY_MIN * 60_000).toISOString(), last_punch: p.last, updated_at: at.toISOString() },
            { onConflict: "day,store", ignoreDuplicates: true }
          );
        } else if (row.first_punch && Date.parse(row.first_punch) > firstMs) {
          // An earlier punch arrived late from the office PC.
          await supabaseAdmin.from("store_open_close").update({ first_punch: p.first, opened_at: new Date(firstMs - OPEN_EARLY_MIN * 60_000).toISOString(), updated_at: at.toISOString() }).eq("day", day).eq("store", store);
        }
        if (!row?.opened_notified_at) {
          const { data: claimed } = await supabaseAdmin
            .from("store_open_close")
            .update({ opened_notified_at: at.toISOString() })
            .eq("day", day)
            .eq("store", store)
            .is("opened_notified_at", null)
            .select("store");
          if (claimed?.length && at.getTime() - firstMs <= NOTIFY_WITHIN_MIN * 60_000) {
            const openedAt = clockIST(firstMs - OPEN_EARLY_MIN * 60_000);
            const n = await notify(store, `Store Opened · ${store}`, `${store} opened at ${openedAt} (first punch ${clockIST(firstMs)}).`);
            notes.push(`${store} opened ${openedAt} → ${n}`);
          }
        }

        // Closing: after closing time, the machine quiet for a while and the office PC still sending.
        const closeMin = timeToMinutes((settings.storeHours[store] ?? settings.storeHours["*"] ?? { close: "22:00" }).close) || 22 * 60;
        const closeTime = dayStartUtc(day) + closeMin * 60_000;
        const quiet = at.getTime() - lastMs >= QUIET_MIN * 60_000;
        const closerPunched = lastMs >= closeTime - CLOSERS_FROM_MIN * 60_000;
        const closedEarly = at.getTime() >= closeTime + EARLY_CLOSE_WAIT_MIN * 60_000;
        if (at.getTime() < closeTime || !quiet || !syncFresh || !(closerPunched || closedEarly)) {
          if (row && !row.closed_notified_at && row.last_punch !== p.last) await supabaseAdmin.from("store_open_close").update({ last_punch: p.last, updated_at: at.toISOString() }).eq("day", day).eq("store", store);
          continue;
        }
        if (!row?.closed_notified_at) {
          const { data: claimed } = await supabaseAdmin
            .from("store_open_close")
            .update({ last_punch: p.last, closed_at: p.last, closed_notified_at: at.toISOString(), updated_at: at.toISOString() })
            .eq("day", day)
            .eq("store", store)
            .is("closed_notified_at", null)
            .select("store");
          if (claimed?.length && at.getTime() - lastMs <= NOTIFY_CLOSE_WITHIN_MIN * 60_000) {
            const n = await notify(store, `Store Closed · ${store}`, `${store} closed at ${clockIST(lastMs)} (last punch).`);
            notes.push(`${store} closed ${clockIST(lastMs)} → ${n}`);
          }
        } else if (row.last_punch && Date.parse(row.last_punch) < lastMs) {
          // Someone punched after the closing notice: the closing moves to that punch.
          await supabaseAdmin.from("store_open_close").update({ last_punch: p.last, closed_at: p.last, updated_at: at.toISOString() }).eq("day", day).eq("store", store);
          const n = await notify(store, `Store Closed (updated) · ${store}`, `${store} closed at ${clockIST(lastMs)} — a later punch than the earlier notice.`);
          notes.push(`${store} close updated ${clockIST(lastMs)} → ${n}`);
        }
      }
    }
    return notes.length ? notes.join("; ") : "nothing due";
  } finally {
    g.__syOpenCloseBusy = false;
  }
}
