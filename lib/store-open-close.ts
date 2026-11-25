// Store opening and closing from the biometric devices (server only).
// Each store has its own punching machine. The first punch of the day opens the store
// (opening time = first punch − 2 minutes); the last punch closes it. "Store Opened" and
// "Store Closed" go to the store's Store Manager / ASM and management (app + phone).
//
// SOP: only the Store Manager or the ASM / Floor Manager of the store opens and closes it, or
// someone the Super Admin allowed for that store (ongoing or for set dates; lib/store-keyholders).
// Opening: the first punch is the opener; if it is someone else but the SM / ASM punches within
// 60 seconds after it, the SM / ASM opened the store. Closing: the same with the last punch (an
// SM / ASM punch within 60 seconds before it). Otherwise it is an SOP violation, which the
// Director (or the Super Admin) can approve with a note.
//
// Closing: staff leaving early punch out in the evening, the closers punch around or after
// closing time. Once a closer has punched and the machine has been quiet for 45 minutes (and
// the office PC is still sending punches), the last punch is the closing. If no one punches
// near closing time, the store closed early: 2 hours after closing time the last punch counts.

import { fetchAll } from "@/lib/fetch-all";
import { supabaseAdmin } from "@/lib/supabase/server";
import { istNow } from "@/lib/business-day";
import { attendanceCode, attendanceSettings, machineEmployees } from "@/lib/attendance";
import { keyHolderFor, loadKeyHolders, type KeyHolder } from "@/lib/store-keyholders";
import { loadPerformanceSettings } from "@/lib/performance-settings";
import { timeToMinutes } from "@/lib/performance-rules";
import { CORPORATE_OFFICE } from "@/lib/stores";
import { siteUrl } from "@/lib/notify";
import { pushToStaff } from "@/lib/push";

/** Within this many seconds of the first / last punch an SM / ASM punch still counts as theirs. */
const SOP_WINDOW_SEC = 60;
export type Sop = "ok" | "violation" | "approved";

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

export type OpenClose = {
  day: string;
  store: string;
  openedAt: string | null;
  closedAt: string | null;
  firstPunch: string | null;
  lastPunch: string | null;
  openedBy: string | null;
  /** Employee code of the person who opened / closed. */
  openedByCode?: string | null;
  closedByCode?: string | null;
  openSop: Sop | null;
  openApproval: string | null;
  closedBy: string | null;
  closeSop: Sop | null;
  closeApproval: string | null;
};

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
  const punches = await fetchAll<{ device: string; emp_code: string }>((a, b) =>
    supabaseAdmin.from("attendance_punches").select("device, emp_code").gte("punch_time", since).not("device", "is", null).order("id").range(a, b)
  );
  const devices = new Set(((punches ?? []) as { device: string }[]).map((p) => String(p.device)));
  const missing = [...devices].filter((d) => !(d in saved));
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
  // A machine nobody can be matched to (its staff have no accounts with that store yet): tell the
  // Super Admins once, so a new store's opening and closing don't go missing quietly.
  const alerted = new Set(((data?.value as { alerted?: string[] } | null)?.alerted ?? []).map(String));
  const unknown = missing.filter((d) => !found[d] && !alerted.has(d) && (punches ?? []).filter((p) => String((p as { device: string }).device) === d).length >= 10);
  if (!Object.keys(found).length && !unknown.length) return saved;
  const map = { ...saved, ...found };
  await supabaseAdmin
    .from("app_settings")
    .upsert({ key: DEVICES_KEY, value: { map, alerted: [...alerted, ...unknown] }, updated_at: new Date().toISOString() });
  if (unknown.length) await alertNewMachines(unknown).catch((e) => console.error("New machine alert failed:", e));
  return map;
}

async function alertNewMachines(devices: string[]) {
  const { data: admins } = await supabaseAdmin.from("staff_users").select("id").eq("is_active", true).eq("role", "super_admin");
  const ids = ((admins ?? []) as { id: string }[]).map((a) => a.id);
  if (!ids.length) return;
  const title = devices.length === 1 ? "New punching machine" : `${devices.length} new punching machines`;
  const body = `Machine ${devices.join(", ")} is sending punches but its store isn't known yet. Choose its store in Settings → Attendance → Punching machines, and its opening and closing times will show.`;
  await supabaseAdmin.from("staff_notifications").insert(ids.map((id) => ({ staff_id: id, ticket_type: null, ticket_id: null, ticket_number: null, title, body })));
  await pushToStaff(ids, { title, body, url: `${siteUrl()}/staff/admin/attendance` }).catch(() => null);
}

export type DeviceInfo = { device: string; store: string | null; punches: number; people: number; lastPunch: string | null; guess: string | null };

/** Every punching machine seen in the last 14 days, its store and who punches on it (Settings → Attendance). */
export async function listDevices(): Promise<DeviceInfo[]> {
  const map = await deviceStores();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [{ data: punches }, { data: staff }] = await Promise.all([
    fetchAll<{ device: string; emp_code: string; punch_time: string }>((a, b) =>
      supabaseAdmin.from("attendance_punches").select("device, emp_code, punch_time").gte("punch_time", since).not("device", "is", null).order("id").range(a, b)
    ).then((data) => ({ data })),
    supabaseAdmin.from("staff_users").select("user_id, store_name"),
  ]);
  const storeOf = new Map(((staff ?? []) as { user_id: string; store_name: string | null }[]).map((s) => [attendanceCode(s.user_id), String(s.store_name ?? "").toUpperCase()]));
  const by = new Map<string, { punches: number; people: Set<string>; last: string; votes: Map<string, number> }>();
  for (const p of (punches ?? []) as { device: string; emp_code: string; punch_time: string }[]) {
    const d = String(p.device);
    const cur = by.get(d) ?? { punches: 0, people: new Set<string>(), last: p.punch_time, votes: new Map<string, number>() };
    cur.punches++;
    const code = attendanceCode(p.emp_code);
    cur.people.add(code);
    if (p.punch_time > cur.last) cur.last = p.punch_time;
    const st = storeOf.get(code);
    if (st && st !== CORPORATE_OFFICE.toUpperCase()) cur.votes.set(st, (cur.votes.get(st) ?? 0) + 1);
    by.set(d, cur);
  }
  const ids = new Set([...by.keys(), ...Object.keys(map)]);
  return [...ids]
    .map((d) => {
      const x = by.get(d);
      const best = x ? [...x.votes.entries()].sort((a, b) => b[1] - a[1])[0] : undefined;
      return { device: d, store: map[d] ?? null, punches: x?.punches ?? 0, people: x?.people.size ?? 0, lastPunch: x?.last ?? null, guess: best?.[0] ?? null };
    })
    .sort((a, b) => b.punches - a.punches);
}

/** Super Admin says which store a machine is in (empty = not a store machine). Earlier days are filled in quietly. */
export async function setDeviceStore(device: string, store: string | null) {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", DEVICES_KEY).maybeSingle();
  const map = { ...(((data?.value as { map?: Record<string, string> } | null)?.map ?? {}) as Record<string, string>) };
  const clean = (store ?? "").trim().toUpperCase();
  // Kept even when cleared ("" = not a store), so the automatic check doesn't put it back.
  map[device] = clean;
  const alerted = (data?.value as { alerted?: string[] } | null)?.alerted ?? [];
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: DEVICES_KEY, value: { map, alerted }, updated_at: new Date().toISOString() });
  if (error) throw error;
  if (clean) await backfillStore(clean, map).catch((e) => console.error("Open/close backfill failed:", e));
}

/** Stores that have a punching machine. */
export async function openCloseStores(): Promise<string[]> {
  const map = await deviceStores().catch(() => ({}) as Record<string, string>);
  return [...new Set(Object.values(map).filter(Boolean))].sort();
}

/** Opening and closing of the last 30 days for a store whose machine was just set (no notices). */
async function backfillStore(store: string, devices: Record<string, string>, days = 30) {
  const deviceIds = Object.entries(devices).filter(([, st]) => st === store).map(([d]) => d);
  if (!deviceIds.length) return 0;
  const today = istNow().date;
  const from = shiftDay(today, -days);
  const { data: have } = await supabaseAdmin.from("store_open_close").select("day").eq("store", store).gte("day", from);
  const done = new Set(((have ?? []) as { day: string }[]).map((r) => r.day));
  const staff = await staffByCode();
  const nowIso = new Date().toISOString();
  let n = 0;
  for (let i = days; i >= 1; i--) {
    const day = shiftDay(today, -i);
    if (done.has(day)) continue;
    const { data: punches } = await supabaseAdmin
      .from("attendance_punches")
      .select("punch_time, emp_code")
      .in("device", deviceIds)
      .gte("punch_time", new Date(dayStartUtc(day) + EARLIEST_OPEN * 60_000).toISOString())
      .lt("punch_time", new Date(dayStartUtc(day) + 86_400_000).toISOString())
      .order("punch_time")
      .limit(2000);
    const rows = (punches ?? []) as { punch_time: string; emp_code: string }[];
    if (!rows.length) continue;
    const list: Punch[] = rows.map((p) => ({ code: attendanceCode(p.emp_code), at: Date.parse(p.punch_time) }));
    const first = rows[0].punch_time;
    const last = rows[rows.length - 1].punch_time;
    const o = whoAndSop(list, store, staff, "open", day);
    const c = whoAndSop(list, store, staff, "close", day);
    await supabaseAdmin.from("store_open_close").upsert(
      {
        day,
        store,
        device: deviceIds[0],
        first_punch: first,
        opened_at: new Date(Date.parse(first) - OPEN_EARLY_MIN * 60_000).toISOString(),
        last_punch: last,
        closed_at: last,
        opened_notified_at: nowIso,
        closed_notified_at: nowIso,
        updated_at: nowIso,
        opened_by: o.code,
        opened_by_name: o.name,
        open_sop: o.sop,
        open_sop_note: o.note,
        closed_by: c.code,
        closed_by_name: c.name,
        close_sop: c.sop,
        close_sop_note: c.note,
      },
      { onConflict: "day,store", ignoreDuplicates: true }
    );
    n++;
  }
  return n;
}

// ------------------------------------------------------------------
// Reading
// ------------------------------------------------------------------

const OC_COLS =
  "day, store, opened_at, closed_at, first_punch, last_punch, opened_by, opened_by_name, open_sop, open_approved_by, open_approval_note, closed_by, closed_by_name, close_sop, close_approved_by, close_approval_note";
type OcRow = Record<string, string | null>;
const toOpenClose = (d: OcRow): OpenClose => ({
  day: String(d.day),
  store: String(d.store),
  openedAt: d.opened_at,
  closedAt: d.closed_at,
  firstPunch: d.first_punch,
  lastPunch: d.last_punch,
  openedBy: d.opened_by_name,
  openedByCode: d.opened_by,
  closedByCode: d.closed_by,
  openSop: (d.open_sop as Sop | null) ?? null,
  openApproval: d.open_approved_by ? `${d.open_approved_by}${d.open_approval_note ? ` — ${d.open_approval_note}` : ""}` : null,
  closedBy: d.closed_by_name,
  closeSop: (d.close_sop as Sop | null) ?? null,
  closeApproval: d.close_approved_by ? `${d.close_approved_by}${d.close_approval_note ? ` — ${d.close_approval_note}` : ""}` : null,
});

/**
 * Names by employee code: staff accounts first, then the eTimeTrackLite employee list. Used so a
 * person shows by name, also when the opening / closing was saved before they had an account.
 */
async function namesByCode(): Promise<Map<string, string>> {
  const [{ data }, machine] = await Promise.all([
    supabaseAdmin.from("staff_users").select("user_id, full_name"),
    machineEmployees().catch(() => ({ list: [] as { code: string; name: string }[] })),
  ]);
  const out = new Map<string, string>();
  for (const e of machine.list) if (e.name) out.set(attendanceCode(e.code), e.name);
  for (const s of (data ?? []) as { user_id: string; full_name: string | null }[]) if (s.full_name) out.set(attendanceCode(s.user_id), s.full_name);
  return out;
}

/** A saved "User ID 1005" becomes the person's name. */
function withNames(rows: OcRow[], names: Map<string, string>): OcRow[] {
  const fix = (saved: string | null, code: string | null) => {
    if (saved && !/^User ID /i.test(saved)) return saved;
    const n = code ? names.get(attendanceCode(code)) : undefined;
    return n ?? saved;
  };
  return rows.map((r) => ({ ...r, opened_by_name: fix(r.opened_by_name, r.opened_by), closed_by_name: fix(r.closed_by_name, r.closed_by) }));
}

export async function loadOpenClose(store: string, day: string): Promise<OpenClose | null> {
  const { data } = await supabaseAdmin.from("store_open_close").select(OC_COLS).eq("store", store).eq("day", day).maybeSingle();
  if (!data) return null;
  return toOpenClose(withNames([data as OcRow], await namesByCode())[0]);
}

/** Openings and closings of a store, newest first. */
export async function loadOpenCloseHistory(store: string, days = 45): Promise<OpenClose[]> {
  const since = shiftDay(istNow().date, -days);
  const { data } = await supabaseAdmin.from("store_open_close").select(OC_COLS).eq("store", store).gte("day", since).order("day", { ascending: false });
  return withNames((data ?? []) as OcRow[], await namesByCode()).map(toOpenClose);
}

/**
 * When the person credited with opening (closing) made their own punch, per day: their first
 * (last) punch of the day on the store's machine. Used to show the CCTV photos at that moment.
 */
export async function punchMoments(store: string, days: string[]): Promise<Map<string, { open: number | null; close: number | null }>> {
  const out = new Map<string, { open: number | null; close: number | null }>();
  if (!days.length) return out;
  const devices = await deviceStores();
  const deviceIds = Object.entries(devices).filter(([, st]) => st === store).map(([d]) => d);
  if (!deviceIds.length) return out;
  const sorted = [...days].sort();
  const { data: rows } = await supabaseAdmin.from("store_open_close").select("day, opened_by, closed_by, closed_at").eq("store", store).in("day", sorted);
  const punches = await fetchAll<{ emp_code: string; punch_time: string }>((a, b) =>
    supabaseAdmin
      .from("attendance_punches")
      .select("emp_code, punch_time")
      .in("device", deviceIds)
      .gte("punch_time", new Date(dayStartUtc(sorted[0]) + EARLIEST_OPEN * 60_000).toISOString())
      .lt("punch_time", new Date(dayStartUtc(sorted[sorted.length - 1]) + 86_400_000).toISOString())
      .order("punch_time")
      .range(a, b)
  );
  const list = ((punches ?? []) as { emp_code: string; punch_time: string }[]).map((p) => ({ code: attendanceCode(p.emp_code), at: Date.parse(p.punch_time) }));
  for (const r of (rows ?? []) as { day: string; opened_by: string | null; closed_by: string | null; closed_at: string | null }[]) {
    const start = dayStartUtc(r.day) + EARLIEST_OPEN * 60_000;
    const end = dayStartUtc(r.day) + 86_400_000;
    const day = list.filter((p) => p.at >= start && p.at < end);
    const opener = r.opened_by ? attendanceCode(r.opened_by) : null;
    const closer = r.closed_by && r.closed_at ? attendanceCode(r.closed_by) : null;
    const open = opener ? day.find((p) => p.code === opener)?.at ?? null : null;
    const close = closer ? [...day].reverse().find((p) => p.code === closer)?.at ?? null : null;
    out.set(r.day, { open, close });
  }
  return out;
}

export type CamCheck = { verdict: "ok" | "proxy"; by: string | null; note: string | null };

/** Camera checks of a store's days (none before the CCTV columns are added). */
export async function loadCamChecks(store: string, days: string[]): Promise<Map<string, { open: CamCheck | null; close: CamCheck | null }>> {
  const out = new Map<string, { open: CamCheck | null; close: CamCheck | null }>();
  if (!days.length) return out;
  const { data, error } = await supabaseAdmin
    .from("store_open_close")
    .select("day, open_cam, open_cam_by, open_cam_note, close_cam, close_cam_by, close_cam_note")
    .eq("store", store)
    .in("day", days);
  if (error) return out;
  for (const r of (data ?? []) as Record<string, string | null>[]) {
    const one = (k: "open" | "close"): CamCheck | null =>
      r[`${k}_cam`] === "ok" || r[`${k}_cam`] === "proxy" ? { verdict: r[`${k}_cam`] as "ok" | "proxy", by: r[`${k}_cam_by`], note: r[`${k}_cam_note`] } : null;
    out.set(String(r.day), { open: one("open"), close: one("close") });
  }
  return out;
}

/** Director / Super Admin approves an SOP violation (opening or closing) with a note. */
export async function approveSop(day: string, store: string, kind: "open" | "close", by: string, note: string) {
  const col = kind === "open" ? "open" : "close";
  const { data, error } = await supabaseAdmin
    .from("store_open_close")
    .update({ [`${col}_sop`]: "approved", [`${col}_approved_by`]: by, [`${col}_approved_at`]: new Date().toISOString(), [`${col}_approval_note`]: note.slice(0, 300) })
    .eq("day", day)
    .eq("store", store)
    .eq(`${col}_sop`, "violation")
    .select("store");
  if (error) throw error;
  return Boolean(data?.length);
}

// ------------------------------------------------------------------
// Who opened / closed (SOP)
// ------------------------------------------------------------------

type Person = { id: string; name: string; group: string; store: string | null };
type Punch = { code: string; at: number };

/** Names from eTimeTrackLite for people without a staff account (refreshed with staffByCode). */
let machineNames = new Map<string, string>();
/** People the Super Admin allowed to open / close a store (refreshed with staffByCode). */
let keyHolders: KeyHolder[] = [];

async function staffByCode(): Promise<Map<string, Person>> {
  const { loadStaffForPerformance } = await import("@/lib/performance");
  const s = await loadPerformanceSettings();
  const [list, machine, keys] = await Promise.all([
    loadStaffForPerformance(s.asmIsFm),
    machineEmployees().catch(() => ({ list: [] as { code: string; name: string }[] })),
    loadKeyHolders().catch(() => [] as KeyHolder[]),
  ]);
  keyHolders = keys;
  machineNames = new Map(machine.list.filter((e) => e.name).map((e) => [attendanceCode(e.code), e.name]));
  return new Map(list.map((p) => [p.userId, { id: p.id, name: p.name, group: p.group, store: p.store }]));
}

const roleShort = (p: Person) => (p.group === "sm" ? "SM" : "ASM / FM");

/** Opener (kind "open") or closer ("close") of a store-day, and whether it follows the SOP. */
function whoAndSop(list: Punch[], store: string, staff: Map<string, Person>, kind: "open" | "close", day: string) {
  // The SM / ASM of the store, or someone the Super Admin allowed to open (close) it that day.
  const lead = (code: string) => {
    const p = staff.get(code);
    return Boolean(p && (p.group === "sm" || p.group === "asm") && (!p.store || p.store === store));
  };
  const allowed = (code: string) => keyHolderFor(keyHolders, store, day, kind, code);
  const isLead = (code: string) => lead(code) || Boolean(allowed(code));
  const label = (code: string) => {
    const p = staff.get(code);
    const name = p?.name ?? machineNames.get(code) ?? `User ID ${code}`;
    if (p && lead(code)) return `${name} (${roleShort(p)})`;
    return allowed(code) ? `${name} (allowed)` : name;
  };
  const edge = kind === "open" ? list[0] : list[list.length - 1];
  if (isLead(edge.code)) return { code: edge.code, name: label(edge.code), sop: "ok" as Sop, note: null as string | null };
  const near = list.find((q) => isLead(q.code) && Math.abs(q.at - edge.at) <= SOP_WINDOW_SEC * 1000 && (kind === "open" ? q.at >= edge.at : q.at <= edge.at));
  if (near) return { code: near.code, name: label(near.code), sop: "ok" as Sop, note: `${label(edge.code)} punched first, ${label(near.code)} within a minute` };
  return { code: edge.code, name: label(edge.code), sop: "violation" as Sop, note: null };
}

// ------------------------------------------------------------------
// Every minute
// ------------------------------------------------------------------

async function recipientsOf(store: string) {
  const { recipients } = await import("@/lib/eod-report");
  return recipients(store);
}

async function notify(store: string, title: string, body: string, violation = false) {
  let people = await recipientsOf(store);
  if (violation) {
    const { findDirectors } = await import("@/lib/notify");
    const directors = await findDirectors(store).catch(() => []);
    const seen = new Set(people.map((p) => p.id));
    people = [...people, ...directors.filter((d) => !seen.has(d.id)).map((d) => ({ ...people[0], ...d }))] as typeof people;
  }
  if (!people.length) return 0;
  await supabaseAdmin.from("staff_notifications").insert(people.map((p) => ({ staff_id: p.id, ticket_type: null, ticket_id: null, ticket_number: null, title, body })));
  await pushToStaff(
    people.map((p) => p.id),
    { title, body, url: `${siteUrl()}/staff/performance/open-close?store=${encodeURIComponent(store)}` }
  ).catch((e) => console.error("Open/close push failed:", e));
  return people.length;
}

type Row = {
  day: string;
  store: string;
  first_punch: string | null;
  opened_notified_at: string | null;
  last_punch: string | null;
  closed_notified_at: string | null;
  opened_by: string | null;
  open_sop: Sop | null;
  closed_by: string | null;
  close_sop: Sop | null;
};

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
    const staff = await staffByCode();

    for (const day of days) {
      const from = new Date(dayStartUtc(day) + EARLIEST_OPEN * 60_000).toISOString();
      const to = new Date(dayStartUtc(day) + 86_400_000).toISOString();
      const { data: punches } = await supabaseAdmin
        .from("attendance_punches")
        .select("device, punch_time, emp_code")
        .gte("punch_time", from)
        .lt("punch_time", to)
        .not("device", "is", null)
        .order("punch_time")
        .limit(5000);
      const byStore = new Map<string, { device: string; first: string; last: string; list: Punch[] }>();
      for (const p of (punches ?? []) as { device: string; punch_time: string; emp_code: string }[]) {
        const store = devices[String(p.device)];
        if (!store) continue;
        const punch = { code: attendanceCode(p.emp_code), at: Date.parse(p.punch_time) };
        const cur = byStore.get(store);
        if (!cur) byStore.set(store, { device: String(p.device), first: p.punch_time, last: p.punch_time, list: [punch] });
        else {
          cur.last = p.punch_time;
          cur.list.push(punch);
        }
      }
      if (!byStore.size) continue;

      const { data: existing } = await supabaseAdmin.from("store_open_close").select("day, store, first_punch, opened_notified_at, last_punch, closed_notified_at, opened_by, open_sop, closed_by, close_sop").eq("day", day);
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
        // Who opened (SOP). Kept up to date while punches arrive; an approval is never undone.
        const opener = whoAndSop(p.list, store, staff, "open", day);
        if (row?.open_sop !== "approved" && (row?.opened_by !== opener.code || row?.open_sop !== opener.sop)) {
          await supabaseAdmin
            .from("store_open_close")
            .update({ opened_by: opener.code, opened_by_name: opener.name, open_sop: opener.sop, open_sop_note: opener.note })
            .eq("day", day)
            .eq("store", store);
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
            const v = opener.sop === "violation";
            const body = v
              ? `⚠ SOP violation: ${store} opened at ${openedAt} by ${opener.name} — not the SM or ASM / FM. Needs the Director's approval.`
              : `${store} opened at ${openedAt} by ${opener.name}.`;
            const n = await notify(store, `Store Opened · ${store}`, body, v);
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
        const closer = whoAndSop(p.list, store, staff, "close", day);
        const closerCols = row?.close_sop === "approved" ? {} : { closed_by: closer.code, closed_by_name: closer.name, close_sop: closer.sop, close_sop_note: closer.note };
        const closeBody = (time: string, updated = false) =>
          closer.sop === "violation"
            ? `⚠ SOP violation: ${store} closed at ${time} by ${closer.name} — not the SM or ASM / FM. Needs the Director's approval.${updated ? " (later punch than the earlier notice)" : ""}`
            : `${store} closed at ${time} by ${closer.name}.${updated ? " (later punch than the earlier notice)" : ""}`;
        if (!row?.closed_notified_at) {
          const { data: claimed } = await supabaseAdmin
            .from("store_open_close")
            .update({ last_punch: p.last, closed_at: p.last, closed_notified_at: at.toISOString(), updated_at: at.toISOString(), ...closerCols })
            .eq("day", day)
            .eq("store", store)
            .is("closed_notified_at", null)
            .select("store");
          if (claimed?.length && at.getTime() - lastMs <= NOTIFY_CLOSE_WITHIN_MIN * 60_000) {
            const n = await notify(store, `Store Closed · ${store}`, closeBody(clockIST(lastMs)), closer.sop === "violation");
            notes.push(`${store} closed ${clockIST(lastMs)} → ${n}`);
          }
        } else if (row.last_punch && Date.parse(row.last_punch) < lastMs) {
          // Someone punched after the closing notice: the closing moves to that punch.
          await supabaseAdmin.from("store_open_close").update({ last_punch: p.last, closed_at: p.last, updated_at: at.toISOString(), ...closerCols }).eq("day", day).eq("store", store);
          const n = await notify(store, `Store Closed (updated) · ${store}`, closeBody(clockIST(lastMs), true), closer.sop === "violation");
          notes.push(`${store} close updated ${clockIST(lastMs)} → ${n}`);
        }
      }
    }
    // Entrance camera vs punches (first entry / last exit).
    const cam = await cameraCheckTick(at, staff).catch((e) => `camera check error: ${e instanceof Error ? e.message : e}`);
    if (cam) notes.push(cam);
    // Earlier days recorded before the SOP check (or still missing who opened / closed): fill in
    // quietly, without notices. Every 10 minutes is enough.
    if (now.minutes % 10 === 0) {
      const filled = await fillPastSop(staff, devices, now.date).catch((e) => `fill error: ${e instanceof Error ? e.message : e}`);
      if (filled) notes.push(filled);
    }
    return notes.length ? notes.join("; ") : "nothing due";
  } finally {
    g.__syOpenCloseBusy = false;
  }
}

async function fillPastSop(staff: Map<string, Person>, devices: Record<string, string>, today: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("store_open_close")
    .select("day, store, closed_at, opened_by, open_sop, closed_by, close_sop")
    .gte("day", shiftDay(today, -30))
    .lt("day", today)
    .or("opened_by.is.null,and(closed_at.not.is.null,closed_by.is.null)");
  let n = 0;
  for (const r of (data ?? []) as { day: string; store: string; closed_at: string | null; opened_by: string | null; open_sop: Sop | null; closed_by: string | null; close_sop: Sop | null }[]) {
    const deviceIds = Object.entries(devices).filter(([, st]) => st === r.store).map(([d]) => d);
    if (!deviceIds.length) continue;
    const { data: punches } = await supabaseAdmin
      .from("attendance_punches")
      .select("punch_time, emp_code")
      .in("device", deviceIds)
      .gte("punch_time", new Date(dayStartUtc(r.day) + EARLIEST_OPEN * 60_000).toISOString())
      .lt("punch_time", new Date(dayStartUtc(r.day) + 86_400_000).toISOString())
      .order("punch_time")
      .limit(2000);
    const list: Punch[] = ((punches ?? []) as { punch_time: string; emp_code: string }[]).map((p) => ({ code: attendanceCode(p.emp_code), at: Date.parse(p.punch_time) }));
    if (!list.length) continue;
    const update: Record<string, unknown> = {};
    if (!r.opened_by && r.open_sop !== "approved") {
      const o = whoAndSop(list, r.store, staff, "open", r.day);
      Object.assign(update, { opened_by: o.code, opened_by_name: o.name, open_sop: o.sop, open_sop_note: o.note });
    }
    if (r.closed_at && !r.closed_by && r.close_sop !== "approved") {
      const c = whoAndSop(list, r.store, staff, "close", r.day);
      Object.assign(update, { closed_by: c.code, closed_by_name: c.name, close_sop: c.sop, close_sop_note: c.note });
    }
    if (Object.keys(update).length) {
      await supabaseAdmin.from("store_open_close").update(update).eq("day", r.day).eq("store", r.store);
      n++;
    }
  }
  return n ? `filled who opened / closed for ${n} earlier day(s)` : "";
}

// ------------------------------------------------------------------
// Camera check: entrance camera vs punches
// ------------------------------------------------------------------
//
// Only the SM / ASM (or someone the Super Admin allowed) may open and close a store, so they must
// be the first in and the last out. Opening: the first person the entrance camera saw that morning
// must be matched by an allowed person's punch within 2 minutes. Closing: the last person the
// camera saw that night must leave within 2 minutes of an allowed person's last punch. Anything
// else is flagged to the Directors, the store's SM, the Super Admin and HR, with the photo.

/** Allowed gap between the camera and an allowed person's punch. */
export const CAM_MATCH_MIN = 2;
/** Camera windows (India time, minutes of the day) for the first entry and the last exit. */
const CAM_OPEN_FROM = 6 * 60;
const CAM_OPEN_TO = 10 * 60 + 30;
const CAM_CLOSE_FROM = 20 * 60 + 30;
const CAM_CLOSE_TO = 24 * 60 + 90; // 1:30 next morning
/** Wait this long after the first entry before judging (punches reach Care every few minutes). */
const CAM_OPEN_WAIT_MIN = 10;

export type CamFlag = "ok" | "early" | "late" | "none";

type CamRow = {
  day: string;
  store: string;
  closed_at: string | null;
  closed_notified_at: string | null;
  open_cam_flag: CamFlag | null;
  open_entry_at: string | null;
  open_cam_alerted_at: string | null;
  close_cam_flag: CamFlag | null;
  close_exit_at: string | null;
  close_cam_alerted_at: string | null;
};

/** Is this code allowed to open (close) this store on this day? */
function allowedFor(staff: Map<string, Person>, store: string, day: string, kind: "open" | "close", code: string) {
  const p = staff.get(code);
  if (p && (p.group === "sm" || p.group === "asm") && (!p.store || p.store === store)) return true;
  return Boolean(keyHolderFor(keyHolders, store, day, kind, code));
}

const nameOf = (staff: Map<string, Person>, code: string) => staff.get(code)?.name ?? machineNames.get(code) ?? `User ID ${code}`;
const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** First (or last) entrance-camera detection of a store in a window. */
async function edgeEvent(store: string, channels: number[], fromMs: number, toMs: number, last: boolean) {
  let q = supabaseAdmin
    .from("cctv_events")
    .select("id, event_at, photo_path")
    .eq("store", store)
    .gte("event_at", new Date(fromMs).toISOString())
    .lt("event_at", new Date(toMs).toISOString())
    .order("event_at", { ascending: !last })
    .limit(1);
  if (channels.length) q = q.in("channel", channels);
  const { data } = await q;
  const e = (data ?? [])[0] as { id: number; event_at: string; photo_path: string | null } | undefined;
  return e ? { id: e.id, at: Date.parse(e.event_at) } : null;
}

async function camAlert(store: string, title: string, body: string) {
  const { findDirectors } = await import("@/lib/notify");
  const [{ data }, directors] = await Promise.all([
    supabaseAdmin.from("staff_users").select("id, role, store_name, incentive_group").eq("is_active", true),
    findDirectors(store).catch(() => []),
  ]);
  const ids = new Set<string>(directors.map((d) => d.id));
  for (const s of (data ?? []) as { id: string; role: string; store_name: string | null; incentive_group: string | null }[]) {
    const own = (s.store_name ?? "").toUpperCase() === store;
    if (["super_admin", "hr_head", "hr_executive"].includes(s.role)) ids.add(s.id);
    else if (own && (s.role === "store_manager" || s.incentive_group === "sm")) ids.add(s.id);
  }
  if (!ids.size) return 0;
  const list = [...ids];
  await supabaseAdmin.from("staff_notifications").insert(list.map((staff_id) => ({ staff_id, ticket_type: null, ticket_id: null, ticket_number: null, title, body })));
  await pushToStaff(list, { title, body, url: `${siteUrl()}/staff/performance/open-close?store=${encodeURIComponent(store)}` }).catch(() => undefined);
  return list.length;
}

/** Runs every minute (from openCloseTick): judges today's opening and the last closing. */
export async function cameraCheckTick(at = new Date(), staffIn?: Map<string, Person>): Promise<string> {
  const { loadCctv } = await import("@/lib/cctv");
  const { links } = await loadCctv();
  if (!links.length) return "";
  const now = istNow(at);
  const days = [shiftDay(now.date, -1), now.date];
  const { data } = await supabaseAdmin
    .from("store_open_close")
    .select("day, store, closed_at, closed_notified_at, open_cam_flag, open_entry_at, open_cam_alerted_at, close_cam_flag, close_exit_at, close_cam_alerted_at")
    .in("day", days)
    .in("store", links.map((l) => l.store));
  const rows = (data ?? []) as CamRow[];
  if (!rows.length) return "";
  const staff = staffIn ?? (await staffByCode());
  const att = await attendanceSettings();
  const syncedTo = att.lastSyncAt ? Date.parse(att.lastSyncAt) : 0;
  const devices = await deviceStores();
  const notes: string[] = [];

  for (const r of rows) {
    const link = links.find((l) => l.store === r.store);
    if (!link) continue;
    const start = dayStartUtc(r.day);
    const deviceIds = Object.entries(devices).filter(([, st]) => st === r.store).map(([d]) => d);
    if (!deviceIds.length) continue;
    const punchList = async () => {
      const { data: p } = await supabaseAdmin
        .from("attendance_punches")
        .select("emp_code, punch_time")
        .in("device", deviceIds)
        .gte("punch_time", new Date(start + EARLIEST_OPEN * 60_000).toISOString())
        .lt("punch_time", new Date(start + 86_400_000).toISOString())
        .order("punch_time")
        .limit(3000);
      return ((p ?? []) as { emp_code: string; punch_time: string }[]).map((x) => ({ code: attendanceCode(x.emp_code), at: Date.parse(x.punch_time) }));
    };

    // Opening: judged once, 10 minutes after the first entry (punches synced past it).
    if (!r.open_cam_flag && r.day === now.date) {
      const openEnd = start + CAM_OPEN_TO * 60_000;
      const entry = await edgeEvent(r.store, link.channels, start + CAM_OPEN_FROM * 60_000, openEnd, false);
      if (!entry) {
        if (at.getTime() > openEnd) await supabaseAdmin.from("store_open_close").update({ open_cam_flag: "none" }).eq("day", r.day).eq("store", r.store);
      } else if (at.getTime() >= entry.at + CAM_OPEN_WAIT_MIN * 60_000 && syncedTo >= entry.at + (CAM_MATCH_MIN + 1) * 60_000) {
        const punches = await punchList();
        // Someone punched well before the camera saw anyone: the camera missed the opening.
        if (punches.length && punches[0].at < entry.at - CAM_MATCH_MIN * 60_000) {
          await supabaseAdmin
            .from("store_open_close")
            .update({ open_cam_flag: "none", open_cam_flag_note: `The entrance camera's first picture (${clockIST(entry.at)}) is after the first punch (${clockIST(punches[0].at)}): the opening was not seen.` })
            .eq("day", r.day)
            .eq("store", r.store);
          continue;
        }
        const allowed = punches.find((p) => allowedFor(staff, r.store, r.day, "open", p.code));
        const ok = Boolean(allowed && allowed.at <= entry.at + CAM_MATCH_MIN * 60_000);
        const firstPunch = punches.find((p) => p.at >= entry.at - CAM_MATCH_MIN * 60_000);
        const note = ok
          ? null
          : allowed
            ? `First person entered at ${clockIST(entry.at)}; the first allowed person (${nameOf(staff, allowed.code)}) punched at ${clockIST(allowed.at)}, ${mins(allowed.at - entry.at)} min later.${firstPunch && firstPunch.code !== allowed.code ? ` First punch after the entry: ${nameOf(staff, firstPunch.code)} at ${clockIST(firstPunch.at)}.` : ""}`
            : `First person entered at ${clockIST(entry.at)}; no SM / ASM / allowed person punched.${firstPunch ? ` First punch: ${nameOf(staff, firstPunch.code)} at ${clockIST(firstPunch.at)}.` : ""}`;
        await supabaseAdmin
          .from("store_open_close")
          .update({ open_entry_at: new Date(entry.at).toISOString(), open_entry_event: entry.id, open_cam_flag: ok ? "ok" : "early", open_cam_flag_note: note })
          .eq("day", r.day)
          .eq("store", r.store);
        await supabaseAdmin.from("cctv_events").update({ keep: true }).eq("id", entry.id);
        if (!ok && !r.open_cam_alerted_at) {
          const { data: claimed } = await supabaseAdmin
            .from("store_open_close")
            .update({ open_cam_alerted_at: at.toISOString() })
            .eq("day", r.day)
            .eq("store", r.store)
            .is("open_cam_alerted_at", null)
            .select("store");
          if (claimed?.length) notes.push(`${r.store} opening flagged → ${await camAlert(r.store, `⚠ Camera check · ${r.store} opening`, note ?? "")}`);
        }
      }
    }

    // Closing: once the closing is known (closing notice sent) and 20 minutes after the last punch;
    // checked again while the night window lasts, in case someone is seen later.
    const closeEnd = start + CAM_CLOSE_TO * 60_000;
    if (r.closed_notified_at && r.closed_at && at.getTime() >= Date.parse(r.closed_at) + 20 * 60_000 && (!r.close_cam_flag || (r.close_cam_flag === "ok" && at.getTime() <= closeEnd + 5 * 60_000))) {
      const exit = await edgeEvent(r.store, link.channels, start + CAM_CLOSE_FROM * 60_000, closeEnd, true);
      if (!exit) {
        if (!r.close_cam_flag && at.getTime() > closeEnd) await supabaseAdmin.from("store_open_close").update({ close_cam_flag: "none" }).eq("day", r.day).eq("store", r.store);
        continue;
      }
      if (r.close_exit_at && Date.parse(r.close_exit_at) >= exit.at) continue; // nothing new
      const punches = await punchList();
      // The camera's last picture is well before the last punch: the closing was not seen.
      const lastAny = punches[punches.length - 1];
      if (lastAny && exit.at < lastAny.at - CAM_MATCH_MIN * 60_000 - 10 * 60_000) {
        if (!r.close_cam_flag && at.getTime() > closeEnd)
          await supabaseAdmin
            .from("store_open_close")
            .update({ close_cam_flag: "none", close_cam_flag_note: `The entrance camera's last picture (${clockIST(exit.at)}) is well before the last punch (${clockIST(lastAny.at)}): the closing was not seen.` })
            .eq("day", r.day)
            .eq("store", r.store);
        continue;
      }
      const allowed = [...punches].reverse().find((p) => allowedFor(staff, r.store, r.day, "close", p.code));
      const ok = Boolean(allowed && exit.at <= allowed.at + CAM_MATCH_MIN * 60_000);
      const lastPunch = punches[punches.length - 1];
      const note = ok
        ? null
        : allowed
          ? `Last person seen leaving at ${clockIST(exit.at)}, ${mins(exit.at - allowed.at)} min after the last allowed person (${nameOf(staff, allowed.code)}) punched at ${clockIST(allowed.at)}.${lastPunch && lastPunch.code !== allowed.code ? ` Last punch: ${nameOf(staff, lastPunch.code)} at ${clockIST(lastPunch.at)}.` : ""}`
          : `Last person seen leaving at ${clockIST(exit.at)}; no SM / ASM / allowed person punched out.${lastPunch ? ` Last punch: ${nameOf(staff, lastPunch.code)} at ${clockIST(lastPunch.at)}.` : ""}`;
      await supabaseAdmin
        .from("store_open_close")
        .update({ close_exit_at: new Date(exit.at).toISOString(), close_exit_event: exit.id, close_cam_flag: ok ? "ok" : "late", close_cam_flag_note: note })
        .eq("day", r.day)
        .eq("store", r.store);
      await supabaseAdmin.from("cctv_events").update({ keep: true }).eq("id", exit.id);
      if (!ok && !r.close_cam_alerted_at) {
        const { data: claimed } = await supabaseAdmin
          .from("store_open_close")
          .update({ close_cam_alerted_at: at.toISOString() })
          .eq("day", r.day)
          .eq("store", r.store)
          .is("close_cam_alerted_at", null)
          .select("store");
        if (claimed?.length) notes.push(`${r.store} closing flagged → ${await camAlert(r.store, `⚠ Camera check · ${r.store} closing`, note ?? "")}`);
      }
    }
  }
  return notes.join("; ");
}

/** Camera check of the days shown (first entry / last exit, flag, note). */
export type CamEdge = { at: string | null; event: number | null; flag: CamFlag | null; note: string | null };
export async function loadCamEdges(store: string, days: string[]): Promise<Map<string, { open: CamEdge; close: CamEdge }>> {
  const out = new Map<string, { open: CamEdge; close: CamEdge }>();
  if (!days.length) return out;
  const { data } = await supabaseAdmin
    .from("store_open_close")
    .select("day, open_entry_at, open_entry_event, open_cam_flag, open_cam_flag_note, close_exit_at, close_exit_event, close_cam_flag, close_cam_flag_note")
    .eq("store", store)
    .in("day", days);
  for (const r of (data ?? []) as Record<string, string | number | null>[]) {
    out.set(String(r.day), {
      open: { at: (r.open_entry_at as string) ?? null, event: (r.open_entry_event as number) ?? null, flag: (r.open_cam_flag as CamFlag) ?? null, note: (r.open_cam_flag_note as string) ?? null },
      close: { at: (r.close_exit_at as string) ?? null, event: (r.close_exit_event as number) ?? null, flag: (r.close_cam_flag as CamFlag) ?? null, note: (r.close_cam_flag_note as string) ?? null },
    });
  }
  return out;
}
