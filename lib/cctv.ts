// CCTV check of store opening and closing (server only).
//
// Each store's TP-Link VIGI NVR sends its "person detected" events, each with a camera photo,
// to the app (NVR: Settings → Event → Alarm Server → /api/cctv/vigi/<link key>). The camera that
// looks at the punching machine shows who was really standing there when the Store Manager /
// ASM's opening or closing punch was recorded, so a punch made for someone else (proxy punch)
// can be seen. The Director / Super Admin looks at the photo and marks it "It's them" or
// "Someone else punched".
//
// Photos: within PUNCH_BEFORE_SEC / PUNCH_AFTER_SEC of an opening / closing punch they are kept
// KEEP_LINKED_DAYS; all others are deleted after KEEP_OTHER_DAYS.

import { randomBytes, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { istNow } from "@/lib/business-day";

export const CCTV_BUCKET = "cctv-photos";
const SETTINGS_KEY = "cctv";
/** Photos this long before / after the opener's (closer's) punch are shown with it. */
export const PUNCH_BEFORE_SEC = 180;
export const PUNCH_AFTER_SEC = 120;
const KEEP_LINKED_DAYS = 90;
const KEEP_OTHER_DAYS = 3;
/** An NVR clock further off than this: the time the event arrived is used instead. */
const CLOCK_TOLERANCE_MIN = 10;
/**
 * Only detections around opening and closing are kept (IST minutes of the day): the recorders send
 * a detection every few seconds all day, and only the opening / closing punches need a photo.
 */
const KEEP_WINDOWS: [number, number][] = [
  [6 * 60, 10 * 60 + 30], // opening: 6:00–10:30
  [20 * 60 + 30, 24 * 60], // closing: 20:30–midnight
  [0, 90], // late closing: midnight–1:30
];
const inKeepWindow = (ms: number) => {
  const m = istNow(new Date(ms)).minutes;
  return KEEP_WINDOWS.some(([a, b]) => m >= a && m < b);
};
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export type CctvLink = {
  id: string;
  /** Secret part of the URL path the NVR sends to. */
  key: string;
  store: string;
  /** Cameras (NVR channel numbers) facing the staff entrance. Empty = every camera. */
  channels: number[];
  createdAt: string;
  createdBy: string;
};

type Saved = { links: CctvLink[] };

let cache: { at: number; value: Saved } | null = null;

export async function loadCctv(force = false): Promise<Saved> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<Saved>;
  const value: Saved = { links: Array.isArray(v.links) ? v.links : [] };
  cache = { at: Date.now(), value };
  return value;
}

async function saveCctv(value: Saved) {
  await supabaseAdmin.from("app_settings").upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  cache = { at: Date.now(), value };
}

export async function addLink(store: string, by: string): Promise<CctvLink> {
  const s = await loadCctv(true);
  const link: CctvLink = {
    id: randomBytes(4).toString("hex"),
    key: randomBytes(18).toString("base64url"),
    store: store.trim().toUpperCase(),
    channels: [],
    createdAt: new Date().toISOString(),
    createdBy: by,
  };
  await saveCctv({ links: [...s.links, link] });
  return link;
}

export async function removeLink(id: string) {
  const s = await loadCctv(true);
  await saveCctv({ links: s.links.filter((l) => l.id !== id) });
}

export async function setLinkChannels(id: string, channels: number[]) {
  const s = await loadCctv(true);
  const clean = [...new Set(channels.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1000))].sort((a, b) => a - b);
  await saveCctv({ links: s.links.map((l) => (l.id === id ? { ...l, channels: clean } : l)) });
}

export async function linkByKey(key: string): Promise<CctvLink | null> {
  if (!key || key.length < 16) return null;
  const find = (s: Saved) => s.links.find((l) => l.key === key) ?? null;
  return find(await loadCctv()) ?? find(await loadCctv(true));
}

// ------------------------------------------------------------------
// What the recorders send (last 40 calls, without photos), for Settings
// ------------------------------------------------------------------

const REQUESTS_KEY = "cctv_requests";
export type CctvRequest = {
  at: string;
  method: string;
  store: string | null;
  key?: string;
  contentType?: string;
  length?: number | null;
  userAgent?: string;
  parts?: string[];
  sample?: string;
  saved?: number;
  photo?: boolean;
  error?: string;
  /** How the request reached the app (x-forwarded-proto) and the path, for checking the hosting. */
  proto?: string | null;
  path?: string;
};

/** Notes common to every call: method, type, size, client, protocol, path. */
export function requestNote(request: Request) {
  return {
    method: request.method,
    contentType: (request.headers.get("content-type") ?? "").slice(0, 120),
    length: Number(request.headers.get("content-length") ?? 0) || null,
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 80),
    proto: request.headers.get("x-forwarded-proto"),
    path: new URL(request.url).pathname.replace(/(\/api\/cctv\/vigi\/)([A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/, "$1$2…").slice(0, 120),
  };
}

export async function logCctvRequest(r: Omit<CctvRequest, "at">) {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", REQUESTS_KEY).maybeSingle();
    const list = Array.isArray((data?.value as { list?: unknown })?.list) ? (data!.value as { list: CctvRequest[] }).list : [];
    const next = [{ at: new Date().toISOString(), ...r }, ...list].slice(0, 40);
    await supabaseAdmin.from("app_settings").upsert({ key: REQUESTS_KEY, value: { list: next }, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn("CCTV request not noted:", e);
  }
}

export async function cctvRequests(): Promise<CctvRequest[]> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", REQUESTS_KEY).maybeSingle();
  return Array.isArray((data?.value as { list?: unknown })?.list) ? (data!.value as { list: CctvRequest[] }).list : [];
}

// ------------------------------------------------------------------
// Events from the NVR
// ------------------------------------------------------------------

type Obj = Record<string, unknown>;
const pick = (m: Obj, keys: string[]) => {
  for (const k of keys) {
    for (const key of Object.keys(m)) if (key.toLowerCase().replace(/[\s_]/g, "") === k) return m[key];
  }
  return undefined;
};
const num = (v: unknown) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.trunc(n) : null;
};

/** "YYYY-MM-DD HH:MM:SS" on the NVR (India time) → ms; null if unreadable. */
function nvrTime(v: unknown): number | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`);
  const n = Number(s);
  if (Number.isFinite(n) && n > 1e9) return n > 1e12 ? n : n * 1000;
  return null;
}

/** Saves the events of one push from an NVR (and its photo). Returns how many were saved. */
export async function saveEvents(link: CctvLink, body: unknown, photo: Blob | null): Promise<number> {
  const b = (body && typeof body === "object" ? body : {}) as Obj;
  const messages = (Array.isArray(b.messages) ? b.messages : Array.isArray(b.message) ? b.message : [b]).filter((m) => m && typeof m === "object") as Obj[];
  const received = Date.now();
  const rows: Record<string, unknown>[] = [];
  for (const m of messages.slice(0, 20)) {
    const channel = num(pick(m, ["channel", "cameranumber", "camera", "chn"]));
    // Only the punching-machine cameras, once they are chosen.
    if (link.channels.length && channel !== null && !link.channels.includes(channel)) continue;
    const timeRaw = pick(m, ["localtime", "datetime", "eventtime", "time", "timestamp"]);
    const t = nvrTime(timeRaw);
    const at = t !== null && Math.abs(t - received) <= CLOCK_TOLERANCE_MIN * 60_000 ? t : received;
    if (!inKeepWindow(at)) continue;
    rows.push({
      store: link.store,
      link_id: link.id,
      device_name: String(b.device_name ?? pick(b, ["devicename"]) ?? "").slice(0, 80) || null,
      channel,
      channel_name: String(pick(m, ["channelname", "cameraname"]) ?? "").slice(0, 80) || null,
      event_type: num(pick(m, ["type", "eventtype"])),
      sub_type: num(pick(m, ["subtype", "eventsubtype"])),
      event_at: new Date(at).toISOString(),
      nvr_time: timeRaw === undefined ? null : String(timeRaw).slice(0, 40),
      received_at: new Date(received).toISOString(),
      raw: m,
    });
  }
  if (!rows.length) return 0;
  // The photo belongs to the first event of the push.
  if (photo && photo.size > 1000 && photo.size <= MAX_PHOTO_BYTES) {
    const day = istNow(new Date(received)).date;
    const path = `${link.store.replace(/[^A-Z0-9]+/g, "-")}/${day}/${randomUUID()}.jpg`;
    const { error } = await supabaseAdmin.storage.from(CCTV_BUCKET).upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (!error) rows[0].photo_path = path;
    else console.warn("CCTV photo upload failed:", error.message);
  }
  const { error } = await supabaseAdmin.from("cctv_events").insert(rows);
  if (error) throw error;
  return rows.length;
}

// ------------------------------------------------------------------
// Photos at a punch
// ------------------------------------------------------------------

export type CamPhoto = { id: number; at: string; offsetSec: number; camera: string; url: string };

/** Photos within the window around each punch (store, ms). One query per store. */
export async function photosAtPunches(store: string, punches: number[]): Promise<Map<number, CamPhoto[]>> {
  const out = new Map<number, CamPhoto[]>();
  if (!punches.length) return out;
  const from = new Date(Math.min(...punches) - PUNCH_BEFORE_SEC * 1000).toISOString();
  const to = new Date(Math.max(...punches) + PUNCH_AFTER_SEC * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("cctv_events")
    .select("id, event_at, channel, channel_name, photo_path")
    .eq("store", store)
    .not("photo_path", "is", null)
    .gte("event_at", from)
    .lte("event_at", to)
    .order("event_at")
    .limit(2000);
  const events = (data ?? []) as { id: number; event_at: string; channel: number | null; channel_name: string | null; photo_path: string }[];
  const chosen = new Map<number, typeof events>();
  for (const at of punches) {
    const near = events
      .filter((e) => {
        const d = Date.parse(e.event_at) - at;
        return d >= -PUNCH_BEFORE_SEC * 1000 && d <= PUNCH_AFTER_SEC * 1000;
      })
      .sort((a, b) => Math.abs(Date.parse(a.event_at) - at) - Math.abs(Date.parse(b.event_at) - at))
      .slice(0, 4)
      .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at));
    chosen.set(at, near);
  }
  const paths = [...new Set([...chosen.values()].flat().map((e) => e.photo_path))];
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const { data: signed } = await supabaseAdmin.storage.from(CCTV_BUCKET).createSignedUrls(paths.slice(i, i + 100), 60 * 60);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  for (const [at, list] of chosen) {
    out.set(
      at,
      list
        .filter((e) => urls.has(e.photo_path))
        .map((e) => ({
          id: e.id,
          at: e.event_at,
          offsetSec: Math.round((Date.parse(e.event_at) - at) / 1000),
          camera: e.channel_name || (e.channel ? `Camera ${e.channel}` : "Camera"),
          url: urls.get(e.photo_path)!,
        }))
    );
  }
  return out;
}

/** The first day the store's NVR sent anything (null = no CCTV yet). */
export async function cctvSince(store: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("cctv_events").select("received_at").eq("store", store).order("received_at").limit(1);
  const r = (data ?? [])[0] as { received_at: string } | undefined;
  return r ? istNow(new Date(r.received_at)).date : null;
}

// ------------------------------------------------------------------
// Settings → Attendance: status of each NVR link
// ------------------------------------------------------------------

export type LinkStatus = CctvLink & {
  lastEventAt: string | null;
  today: number;
  cameras: { channel: number | null; name: string; lastAt: string; photo: string | null }[];
  clockOffMin: number | null;
};

export async function linkStatuses(): Promise<LinkStatus[]> {
  const { links } = await loadCctv(true);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const todayStart = new Date(Date.parse(`${istNow().date}T00:00:00+05:30`)).toISOString();
  const out: LinkStatus[] = [];
  for (const l of links) {
    const { data } = await supabaseAdmin
      .from("cctv_events")
      .select("channel, channel_name, received_at, nvr_time, photo_path")
      .eq("link_id", l.id)
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(500);
    const rows = (data ?? []) as { channel: number | null; channel_name: string | null; received_at: string; nvr_time: string | null; photo_path: string | null }[];
    const cams = new Map<string, { channel: number | null; name: string; lastAt: string; path: string | null }>();
    for (const r of rows) {
      const k = String(r.channel ?? "?");
      const c = cams.get(k);
      if (!c) cams.set(k, { channel: r.channel, name: r.channel_name || (r.channel ? `Camera ${r.channel}` : "Camera"), lastAt: r.received_at, path: r.photo_path });
      else if (!c.path && r.photo_path) c.path = r.photo_path;
    }
    const paths = [...cams.values()].map((c) => c.path).filter(Boolean) as string[];
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await supabaseAdmin.storage.from(CCTV_BUCKET).createSignedUrls(paths, 60 * 60);
      for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
    }
    const last = rows[0];
    const t = last ? nvrTime(last.nvr_time) : null;
    out.push({
      ...l,
      lastEventAt: last?.received_at ?? null,
      today: rows.filter((r) => r.received_at >= todayStart).length,
      cameras: [...cams.values()]
        .sort((a, b) => (a.channel ?? 999) - (b.channel ?? 999))
        .map((c) => ({ channel: c.channel, name: c.name, lastAt: c.lastAt, photo: c.path ? urls.get(c.path) ?? null : null })),
      clockOffMin: last && t !== null ? Math.round((t - Date.parse(last.received_at)) / 60_000) : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------
// Camera check by the Director / Super Admin
// ------------------------------------------------------------------

export async function setCamCheck(day: string, store: string, kind: "open" | "close", verdict: "ok" | "proxy" | null, by: string, note: string) {
  const c = kind === "open" ? "open" : "close";
  const { data, error } = await supabaseAdmin
    .from("store_open_close")
    .update({ [`${c}_cam`]: verdict, [`${c}_cam_by`]: verdict ? by : null, [`${c}_cam_at`]: verdict ? new Date().toISOString() : null, [`${c}_cam_note`]: verdict ? note.slice(0, 300) || null : null })
    .eq("day", day)
    .eq("store", store)
    .select("store");
  if (error) throw error;
  return Boolean(data?.length);
}

// ------------------------------------------------------------------
// Clean-up (hourly): keep photos at opening / closing punches, delete the rest after 3 days
// ------------------------------------------------------------------

const g = globalThis as unknown as { __syCctvCleanAt?: number };

export async function cctvCleanupTick(punchesOf: (store: string, day: string) => Promise<number[]>): Promise<string> {
  if (g.__syCctvCleanAt && Date.now() - g.__syCctvCleanAt < 60 * 60_000) return "";
  g.__syCctvCleanAt = Date.now();
  const today = istNow().date;
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  // 1. Mark photos at the opening / closing punches of the last few days as kept.
  const { data: days } = await supabaseAdmin
    .from("store_open_close")
    .select("day, store")
    .gte("day", shift(today, -(KEEP_OTHER_DAYS + 1)));
  let kept = 0;
  for (const r of (days ?? []) as { day: string; store: string }[]) {
    for (const at of await punchesOf(r.store, r.day)) {
      const { data } = await supabaseAdmin
        .from("cctv_events")
        .update({ keep: true })
        .eq("store", r.store)
        .eq("keep", false)
        .not("photo_path", "is", null)
        .gte("event_at", new Date(at - PUNCH_BEFORE_SEC * 1000).toISOString())
        .lte("event_at", new Date(at + PUNCH_AFTER_SEC * 1000).toISOString())
        .select("id");
      kept += data?.length ?? 0;
    }
  }

  // 2. Delete old photos (and their events).
  let removed = 0;
  for (const [keep, days] of [
    [false, KEEP_OTHER_DAYS],
    [true, KEEP_LINKED_DAYS],
  ] as const) {
    const before = new Date(Date.now() - days * 86_400_000).toISOString();
    for (let round = 0; round < 20; round++) {
      const { data } = await supabaseAdmin.from("cctv_events").select("id, photo_path").eq("keep", keep).lt("received_at", before).limit(500);
      const list = (data ?? []) as { id: number; photo_path: string | null }[];
      if (!list.length) break;
      const paths = list.map((e) => e.photo_path).filter(Boolean) as string[];
      if (paths.length) await supabaseAdmin.storage.from(CCTV_BUCKET).remove(paths);
      await supabaseAdmin.from("cctv_events").delete().in("id", list.map((e) => e.id));
      removed += list.length;
      if (list.length < 500) break;
    }
  }
  return kept || removed ? `cctv: kept ${kept} photo(s) at punches, removed ${removed} old event(s)` : "";
}

/** Signed photo links (1 hour) for event ids. */
export async function eventPhotos(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const list = [...new Set(ids.filter((n) => Number.isFinite(n)))];
  if (!list.length) return out;
  const { data } = await supabaseAdmin.from("cctv_events").select("id, photo_path").in("id", list);
  const rows = ((data ?? []) as { id: number; photo_path: string | null }[]).filter((r) => r.photo_path);
  if (!rows.length) return out;
  const { data: signed } = await supabaseAdmin.storage.from(CCTV_BUCKET).createSignedUrls(rows.map((r) => r.photo_path!), 60 * 60);
  const byPath = new Map<string, string>();
  for (const x of (signed ?? []) as { path: string | null; signedUrl: string | null }[]) if (x.path && x.signedUrl) byPath.set(x.path, x.signedUrl);
  for (const r of rows) {
    const u = byPath.get(r.photo_path!);
    if (u) out.set(r.id, u);
  }
  return out;
}
