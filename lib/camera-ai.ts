// AI photo check of the entrance cameras (server only).
//
// Every doorway-line crossing photo is sent to a vision AI (Anthropic Claude or OpenAI, whichever key
// is set in the hosting: ANTHROPIC_API_KEY or OPENAI_API_KEY). It answers: how many people, how many
// in the staff uniform, how many separate customer parties (people who came together count as one),
// which way they are walking, and whether any of the "people to watch" is in the photo.
//
//  - Walk-ins from the camera use it to leave out staff and count groups once (lib/walkins.ts).
//  - People to watch: their in / out times are collected for the day and e-mailed with the photos
//    at the report time; then the day's sightings are deleted (nothing is kept in the app).

import { supabaseAdmin } from "@/lib/supabase/server";
import { istNow } from "@/lib/business-day";

const KEY = "camera_ai";
const WATCH_BUCKET = "watch-photos";

export type CameraAiSettings = {
  on: boolean;
  /** Model name (empty = the default of the provider). */
  model: string;
  /** How staff are dressed (the AI leaves them out of walk-ins). */
  uniform: string;
  /** Most photos checked per day (cost limit). */
  dailyLimit: number;
  /** When the daily e-mail about the people to watch is sent (HH:MM, India time). */
  reportTime: string;
};

export const DEFAULT_AI: CameraAiSettings = {
  on: true,
  model: "",
  uniform:
    "Staff wear BLACK uniform with the Seven Years logo (often a 'V' logo on the back): men a black T-shirt or shirt, women a black top / kurta with black trousers. Store Managers wear a maroon shirt with the Seven Years logo. Anyone dressed like this is staff, not a customer.",
  dailyLimit: 3000,
  reportTime: "23:30",
};

export function cleanAi(v: unknown): CameraAiSettings {
  const r = (v ?? {}) as Partial<CameraAiSettings>;
  const n = Math.round(Number(r.dailyLimit));
  return {
    on: typeof r.on === "boolean" ? r.on : DEFAULT_AI.on,
    model: typeof r.model === "string" ? r.model.trim().slice(0, 80) : DEFAULT_AI.model,
    uniform: typeof r.uniform === "string" && r.uniform.trim() ? r.uniform.trim().slice(0, 600) : DEFAULT_AI.uniform,
    dailyLimit: Number.isFinite(n) && n >= 10 && n <= 50000 ? n : DEFAULT_AI.dailyLimit,
    reportTime: typeof r.reportTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.reportTime) ? r.reportTime : DEFAULT_AI.reportTime,
  };
}

export async function loadAiSettings(): Promise<CameraAiSettings> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", KEY).maybeSingle();
  return cleanAi(data?.value);
}

export async function saveAiSettings(s: CameraAiSettings) {
  const { error } = await supabaseAdmin.from("app_settings").upsert({ key: KEY, value: cleanAi(s), updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Which AI service the hosting has a key for. */
export function aiProvider(): "anthropic" | "openai" | null {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}
const defaultModel = (p: "anthropic" | "openai") => (p === "anthropic" ? "claude-haiku-5-5" : "gpt-4o-mini");

// ------------------------------------------------------------------
// The call
// ------------------------------------------------------------------

type Img = { b64: string; label?: string; detail?: "low" | "high" };

async function visionJson(prompt: string, images: Img[], model: string): Promise<Record<string, unknown>> {
  const provider = aiProvider();
  if (!provider) throw new Error("No AI key in the hosting (ANTHROPIC_API_KEY or OPENAI_API_KEY).");
  const m = model || defaultModel(provider);
  let text = "";
  if (provider === "anthropic") {
    const content: unknown[] = [];
    for (const im of images) {
      if (im.label) content.push({ type: "text", text: im.label });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.b64 } });
    }
    content.push({ type: "text", text: prompt });
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: m, max_tokens: 1500, messages: [{ role: "user", content }] }),
    });
    const d = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`AI (${m}): ${d.error?.message ?? res.status}`);
    text = (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  } else {
    const content: unknown[] = [];
    for (const im of images) {
      if (im.label) content.push({ type: "text", text: im.label });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${im.b64}`, detail: im.detail ?? "high" } });
    }
    content.push({ type: "text", text: prompt });
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: m, max_completion_tokens: 3000, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }),
    });
    const d = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`AI (${m}): ${d.error?.message ?? res.status}`);
    text = d.choices?.[0]?.message?.content ?? "";
  }
  const j = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(j) as Record<string, unknown>;
}

const toB64 = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString("base64");

// ------------------------------------------------------------------
// People to watch
// ------------------------------------------------------------------

export type WatchPerson = {
  id: string;
  staff_id: string | null;
  name: string;
  store: string;
  photo_path: string | null;
  emails: string;
  active: boolean;
};

export async function listWatch(): Promise<WatchPerson[]> {
  const { data, error } = await supabaseAdmin.from("watch_people").select("id, staff_id, name, store, photo_path, emails, active").order("name");
  if (error) throw error;
  return (data ?? []) as WatchPerson[];
}

export async function watchPhotoUrl(path: string | null) {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage.from(WATCH_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

export async function saveWatch(input: Partial<WatchPerson> & { photoB64?: string | null }) {
  const row: Record<string, unknown> = {
    name: String(input.name ?? "").trim().slice(0, 80),
    store: String(input.store ?? "").trim().toUpperCase().slice(0, 60),
    staff_id: input.staff_id || null,
    emails: String(input.emails ?? "")
      .split(/[\s,;]+/)
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      .join(", "),
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  if (!row.name || !row.store) throw new Error("Choose the person and the store.");
  if (!row.emails) throw new Error("Enter at least one e-mail address for the daily report.");
  let id = input.id ?? null;
  if (id) {
    const { error } = await supabaseAdmin.from("watch_people").update(row).eq("id", id);
    if (error) throw error;
  } else {
    const { data, error } = await supabaseAdmin.from("watch_people").insert(row).select("id").single();
    if (error) throw error;
    id = (data as { id: string }).id;
  }
  if (input.photoB64) {
    const bytes = Buffer.from(input.photoB64.replace(/^data:[^,]+,/, ""), "base64");
    if (bytes.length > 2 * 1024 * 1024) throw new Error("The photo is too large (2 MB at most).");
    const path = `${id}.jpg`;
    const { error } = await supabaseAdmin.storage.from(WATCH_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    await supabaseAdmin.from("watch_people").update({ photo_path: path }).eq("id", id);
  }
  return id!;
}

export async function deleteWatch(id: string) {
  await supabaseAdmin.storage.from(WATCH_BUCKET).remove([`${id}.jpg`]);
  const { error } = await supabaseAdmin.from("watch_people").delete().eq("id", id);
  if (error) throw error;
}

// ------------------------------------------------------------------
// Checking the doorway photos (every minute, a few at a time)
// ------------------------------------------------------------------

export type DoorCheck = {
  people: number;
  staff: number;
  customers: number;
  groups: number;
  direction: "in" | "out" | "unclear";
  watched: string[];
};

const g = globalThis as unknown as {
  __syAiBusy?: boolean;
  __syAiError?: string;
  __syAiRefs?: { at: number; refs: Map<string, Img & { id: string }> };
  __syAiExamples?: Map<string, { at: number; images: Img[]; notes: string[] }>;
};

export const aiLastError = () => g.__syAiError ?? null;

async function refPhotos(people: WatchPerson[]) {
  if (g.__syAiRefs && Date.now() - g.__syAiRefs.at < 10 * 60_000) return g.__syAiRefs.refs;
  const refs = new Map<string, Img & { id: string }>();
  for (const p of people) {
    if (!p.photo_path || !p.active) continue;
    const { data } = await supabaseAdmin.storage.from(WATCH_BUCKET).download(p.photo_path);
    if (data) refs.set(p.id, { id: p.id, b64: await toB64(data), label: `Reference photo of person "${p.id}" (${p.name}):` });
  }
  g.__syAiRefs = { at: Date.now(), refs };
  return refs;
}

/** Ask the AI about one doorway photo. It first describes every person, then we count. */
export async function checkDoorPhoto(
  photo: Blob,
  s: CameraAiSettings,
  refs: (Img & { id: string })[],
  model?: string,
  store?: string,
  /** Customers already counted at this store in the last minutes (their descriptions). */
  recent: string[] = []
): Promise<DoorCheck & { persons?: unknown[]; newCustomers?: string[] }> {
  const learned = store ? await storeExamples(store).catch(() => ({ images: [] as Img[], notes: [] as string[] })) : { images: [] as Img[], notes: [] as string[] };
  const lessons = learned.images.length || learned.notes.length
    ? `\nLEARN FROM THE MANAGER'S CORRECTIONS AT THIS STORE: ${learned.images.length ? "the example photos above were checked by the manager and labelled. People who look or act like those marked STAFF are staff; do not repeat those mistakes." : ""}${learned.notes.length ? `\nManager's notes:\n${learned.notes.map((n) => `- ${n}`).join("\n")}` : ""}\n`
    : "";
  const prompt = `This is a CCTV snapshot from the entrance camera of a Seven Years baby and kids store in Kerala, India. It was taken when someone crossed a line drawn on the floor near the entrance.

STAFF: ${s.uniform}
Also treat as staff: anyone standing behind the billing counter, arranging or carrying stock, and people in matching dark clothes standing together (a staff meeting).
Cleaning staff wear their own clothes: anyone holding or near a mop, broom, bucket, cleaning cloth or cleaning trolley is staff.
Women staff may also wear a long black dress / abaya with a scarf. A person dressed all in black counts as a customer ONLY if they are clearly a shopper: coming in through the entrance from outside, with family or children, or carrying a handbag / shopping bag.
CUSTOMERS: shoppers in their own everyday clothes (coloured saree, churidar / kurta, shirt, jeans, children).
IGNORE completely: mannequins and display figures, toys, pictures, posters, and anyone outside the glass.
${lessons}${refs.length ? `Reference photos of people to look for were given above, each with its id. A person matches only if face, build and clothes clearly fit; if unsure, do not list them.\n` : ""}
${recent.length ? `CUSTOMERS ALREADY COUNTED in the last ${RECENT_MIN} minutes (they walk around the store and may cross the line again):\n${recent.map((d, n) => `${n + 1}. ${d}`).join("\n")}\n` : ""}
Describe EVERY real person you can see in the store, then decide for each one:
- "staff": true if they wear the staff uniform or fit the staff rules above. If you are not sure, answer true.
- "moving": "in" if they are coming in through the entrance, "out" if they are leaving through the entrance, "inside" if they are walking around inside the store, "still" if standing, sitting or working.
- "new" (customers only): false if this customer is clearly one of the customers already counted above (same person, same clothes), otherwise true.

Answer with JSON only:
{"persons": [{"where": "<where in the picture>", "clothes": "<short description: gender, age group, colours, what they carry>", "staff": true|false, "moving": "in"|"out"|"inside"|"still", "new": true|false}], "parties": <how many separate parties the NEW customers form: a family, a couple or friends together are ONE party>, "watched": [<ids of the reference people in this photo>]}`;
  const images: Img[] = [...learned.images, ...refs, { b64: await toB64(photo), label: "CCTV snapshot to check:" }];
  const r = await visionJson(prompt, images, model || s.model);
  type P = { staff?: unknown; moving?: unknown; new?: unknown; clothes?: unknown };
  const persons = (Array.isArray(r.persons) ? r.persons : []).filter((x): x is P => Boolean(x) && typeof x === "object").slice(0, 50);
  const isStaff = (p: P) => p.staff !== false; // unsure = staff
  // A customer is counted once: moving (coming in or walking inside, not leaving) and not already counted.
  const fresh = persons.filter((p) => !isStaff(p) && (p.moving === "in" || p.moving === "inside") && p.new !== false);
  const customersIn = fresh.length;
  const goingOut = persons.filter((p) => p.moving === "out").length;
  const comingIn = persons.filter((p) => p.moving === "in").length;
  const parties = Math.round(Number(r.parties) || 0);
  const ids = new Set(refs.map((x) => x.id));
  return {
    people: persons.length,
    staff: persons.filter(isStaff).length,
    customers: customersIn,
    groups: customersIn ? Math.max(1, Math.min(customersIn, parties || 1)) : 0,
    direction: customersIn || comingIn > goingOut ? "in" : goingOut > comingIn ? "out" : "unclear",
    watched: Array.isArray(r.watched) ? r.watched.map(String).filter((x) => ids.has(x)) : [],
    persons,
    newCustomers: fresh.map((p) => String(p.clothes ?? "customer").slice(0, 160)),
  };
}

/** How far back a customer counts as "already counted" (they walk around and cross the line again). */
const RECENT_MIN = 45;

/** Descriptions of the customers counted at a store in the minutes before a photo. */
export async function recentCustomers(store: string, at: string): Promise<string[]> {
  const t = Date.parse(at);
  const { data } = await supabaseAdmin
    .from("cctv_events")
    .select("ai")
    .eq("store", store)
    .gte("event_at", new Date(t - RECENT_MIN * 60_000).toISOString())
    .lt("event_at", at)
    .not("ai_at", "is", null)
    .order("event_at", { ascending: false })
    .limit(200);
  const out: string[] = [];
  for (const r of (data ?? []) as { ai: { newCustomers?: unknown } | null }[]) {
    if (Array.isArray(r.ai?.newCustomers)) for (const d of r.ai.newCustomers) if (typeof d === "string") out.push(d);
  }
  return out.slice(0, 20);
}

// ------------------------------------------------------------------
// Learning from the manager's marks (Walk-in photos → "Not a customer — staff" / "This is a customer")
// ------------------------------------------------------------------

const EXAMPLE_BUCKET = "camera-ai-examples";
export type MarkVerdict = "staff" | "customer";
export type Mark = { event_id: number; store: string; verdict: MarkVerdict; note: string | null; by_name: string | null; created_at: string };

/** Marks of these photos (the walk-in count follows them). */
export async function loadMarks(eventIds: number[]): Promise<Map<number, Mark>> {
  const out = new Map<number, Mark>();
  const ids = [...new Set(eventIds)];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabaseAdmin.from("camera_ai_marks").select("event_id, store, verdict, note, by_name, created_at").in("event_id", ids.slice(i, i + 300));
    if (error) return out; // table not created yet
    for (const m of (data ?? []) as Mark[]) out.set(Number(m.event_id), m);
  }
  return out;
}

/** Mark a doorway photo; a copy of the photo is kept so the AI keeps learning after CCTV photos are deleted. */
export async function markEvent(eventId: number, verdict: MarkVerdict, note: string, by: string) {
  const { data: ev } = await supabaseAdmin.from("cctv_events").select("id, store, photo_path").eq("id", eventId).maybeSingle();
  const e = ev as { id: number; store: string; photo_path: string | null } | null;
  if (!e) throw new Error("That photo was not found.");
  let examplePath: string | null = null;
  if (e.photo_path) {
    const { CCTV_BUCKET } = await import("@/lib/cctv");
    const { data: blob } = await supabaseAdmin.storage.from(CCTV_BUCKET).download(e.photo_path);
    if (blob) {
      examplePath = `${e.store}/${e.id}.jpg`;
      const { error } = await supabaseAdmin.storage.from(EXAMPLE_BUCKET).upload(examplePath, Buffer.from(await blob.arrayBuffer()), { contentType: "image/jpeg", upsert: true });
      if (error) examplePath = null;
    }
  }
  const { error } = await supabaseAdmin.from("camera_ai_marks").upsert({
    event_id: e.id,
    store: e.store,
    verdict,
    note: note.trim().slice(0, 200) || null,
    example_path: examplePath,
    by_name: by,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  g.__syAiExamples?.delete(e.store);
}

export async function unmarkEvent(eventId: number) {
  const { data } = await supabaseAdmin.from("camera_ai_marks").select("store, example_path").eq("event_id", eventId).maybeSingle();
  const m = data as { store: string; example_path: string | null } | null;
  if (!m) return;
  if (m.example_path) await supabaseAdmin.storage.from(EXAMPLE_BUCKET).remove([m.example_path]);
  const { error } = await supabaseAdmin.from("camera_ai_marks").delete().eq("event_id", eventId);
  if (error) throw error;
  g.__syAiExamples?.delete(m.store);
}

/** How many marks the AI learns from (per store). */
export async function markCounts(): Promise<Record<string, { staff: number; customer: number }>> {
  const { data, error } = await supabaseAdmin.from("camera_ai_marks").select("store, verdict").limit(5000);
  if (error) return {};
  const out: Record<string, { staff: number; customer: number }> = {};
  for (const m of (data ?? []) as { store: string; verdict: MarkVerdict }[]) {
    out[m.store] ??= { staff: 0, customer: 0 };
    out[m.store][m.verdict]++;
  }
  return out;
}

/** The latest marked photos of a store (shown to the AI as labelled examples) and the manager's notes. */
async function storeExamples(store: string): Promise<{ images: Img[]; notes: string[] }> {
  g.__syAiExamples ??= new Map();
  const hit = g.__syAiExamples.get(store);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const { data, error } = await supabaseAdmin
    .from("camera_ai_marks")
    .select("verdict, note, example_path, created_at")
    .eq("store", store)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return { images: [], notes: [] };
  const marks = (data ?? []) as { verdict: MarkVerdict; note: string | null; example_path: string | null }[];
  // A few photos of each kind (cost), the most recent first; all notes (short text).
  const pick = [...marks.filter((m) => m.verdict === "staff" && m.example_path).slice(0, 4), ...marks.filter((m) => m.verdict === "customer" && m.example_path).slice(0, 2)];
  const images: Img[] = [];
  for (const m of pick) {
    const { data: blob } = await supabaseAdmin.storage.from(EXAMPLE_BUCKET).download(m.example_path!);
    if (!blob) continue;
    images.push({
      b64: await toB64(blob),
      detail: "low",
      label:
        m.verdict === "staff"
          ? `EXAMPLE checked by the manager: the people in this photo are STAFF, not customers${m.note ? ` (${m.note})` : ""}. Do not count people like them.`
          : `EXAMPLE checked by the manager: this photo shows a CUSTOMER coming in${m.note ? ` (${m.note})` : ""}.`,
    });
  }
  const notes = [...new Set(marks.map((m) => m.note?.trim()).filter((n): n is string => Boolean(n)))].slice(0, 20).map((n) => n.slice(0, 200));
  const out = { at: Date.now(), images, notes };
  g.__syAiExamples.set(store, out);
  return out;
}

/** Check today's photos of a store again (not the marked ones), e.g. after new marks. */
export async function recheckToday(store: string): Promise<number> {
  const day = istNow().date;
  const from = new Date(Date.parse(`${day}T00:00:00+05:30`)).toISOString();
  const { data } = await supabaseAdmin.from("cctv_events").select("id").eq("store", store).gte("event_at", from).not("ai_at", "is", null).limit(3000);
  const ids = ((data ?? []) as { id: number }[]).map((r) => r.id);
  const marked = await loadMarks(ids);
  const todo = ids.filter((id) => !marked.has(id));
  for (let i = 0; i < todo.length; i += 300) {
    const part = todo.slice(i, i + 300);
    await supabaseAdmin.from("watch_sightings").delete().in("event_id", part);
    await supabaseAdmin.from("cctv_events").update({ ai: null, ai_at: null }).in("id", part);
  }
  g.__syAiExamples?.delete(store);
  return todo.length;
}

/** Called every minute: checks up to a few new doorway photos. */
export async function cameraAiTick(): Promise<string> {
  if (g.__syAiBusy || !aiProvider()) return "";
  g.__syAiBusy = true;
  try {
    const s = await loadAiSettings();
    if (!s.on) return "";
    const { loadCctv, CCTV_BUCKET } = await import("@/lib/cctv");
    const { links, watch } = await loadCctv();
    if (!watch.walkinCode) return "";
    const today = istNow().date;
    const dayStart = new Date(Date.parse(`${today}T00:00:00+05:30`)).toISOString();
    const { count } = await supabaseAdmin.from("cctv_events").select("id", { count: "exact", head: true }).gte("ai_at", dayStart);
    if ((count ?? 0) >= s.dailyLimit) return "daily limit reached";
    const { data } = await supabaseAdmin
      .from("cctv_events")
      .select("id, store, channel, event_at, photo_path")
      .is("ai_at", null)
      .not("photo_path", "is", null)
      .filter("raw->sub_type", "cs", `[${watch.walkinCode}]`)
      .gte("event_at", dayStart) // today's photos only (oldest first, so a backlog catches up)
      .order("event_at")
      .limit(16);
    const rows = (data ?? []) as { id: number; store: string; channel: number | null; event_at: string; photo_path: string }[];
    if (!rows.length) return "";
    const people = (await listWatch().catch(() => [])).filter((p) => p.active);
    const refs = await refPhotos(people);
    let done = 0;
    let failed = false;
    const one = async (r: (typeof rows)[number]) => {
      if (failed) return;
      const link = links.find((l) => l.store === r.store);
      if (!link || (link.channels.length && r.channel !== null && !link.channels.includes(r.channel))) {
        await supabaseAdmin.from("cctv_events").update({ ai_at: new Date().toISOString(), ai: { skipped: true } }).eq("id", r.id);
        return;
      }
      const { data: blob } = await supabaseAdmin.storage.from(CCTV_BUCKET).download(r.photo_path);
      if (!blob) {
        await supabaseAdmin.from("cctv_events").update({ ai_at: new Date().toISOString(), ai: { error: "photo missing" } }).eq("id", r.id);
        return;
      }
      const storeRefs = people.filter((p) => p.store === r.store).map((p) => refs.get(p.id)).filter((x): x is Img & { id: string } => Boolean(x));
      try {
        const res = await checkDoorPhoto(blob, s, storeRefs, undefined, r.store, await recentCustomers(r.store, r.event_at).catch(() => []));
        await supabaseAdmin.from("cctv_events").update({ ai_at: new Date().toISOString(), ai: res }).eq("id", r.id);
        for (const id of res.watched) {
          await supabaseAdmin.from("watch_sightings").insert({ watch_id: id, event_id: r.id, store: r.store, at: r.event_at, direction: res.direction, photo_path: r.photo_path });
        }
        g.__syAiError = undefined;
        done++;
      } catch (e) {
        g.__syAiError = e instanceof Error ? e.message : String(e);
        failed = true; // try again next minute (key missing, limit, network…)
      }
    };
    // In time order within a store (so a customer already counted is known), stores side by side.
    const byStore = new Map<string, typeof rows>();
    for (const r of rows) byStore.set(r.store, [...(byStore.get(r.store) ?? []), r]);
    await Promise.all(
      [...byStore.values()].map(async (list) => {
        for (const r of list) {
          if (failed) return;
          await one(r);
        }
      })
    );
    return done ? `${done} doorway photo(s) checked` : g.__syAiError ? `AI error: ${g.__syAiError}` : "";
  } finally {
    g.__syAiBusy = false;
  }
}

// ------------------------------------------------------------------
// Daily e-mail about the people to watch
// ------------------------------------------------------------------

const clock = (t: string) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const dur = (ms: number) => {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

/** In / out times and the time inside, from the day's sightings (direction from the AI). */
export function inOut(rows: { at: string; direction: string }[]) {
  const list = [...rows].sort((a, b) => a.at.localeCompare(b.at));
  const moves: { at: string; dir: "in" | "out" }[] = [];
  let inside = false;
  for (const r of list) {
    // "Unclear" alternates with the last known state; repeats within 2 minutes are the same crossing.
    const dir: "in" | "out" = r.direction === "in" || r.direction === "out" ? r.direction : inside ? "out" : "in";
    const last = moves[moves.length - 1];
    if (last && last.dir === dir && Date.parse(r.at) - Date.parse(last.at) < 120_000) continue;
    moves.push({ at: r.at, dir });
    inside = dir === "in";
  }
  let total = 0;
  let since: number | null = null;
  for (const m of moves) {
    if (m.dir === "in" && since === null) since = Date.parse(m.at);
    if (m.dir === "out" && since !== null) {
      total += Date.parse(m.at) - since;
      since = null;
    }
  }
  return { moves, totalMs: total, openEnded: since !== null };
}

/** Called every minute: at the report time, e-mails each person's day and deletes the sightings. */
export async function watchReportTick(): Promise<string> {
  const s = await loadAiSettings();
  const now = istNow();
  const [h, m] = s.reportTime.split(":").map(Number);
  if (now.minutes < h * 60 + m) return "";
  const { data: done } = await supabaseAdmin.from("app_settings").select("value").eq("key", "watch_report_day").maybeSingle();
  if ((done?.value as { day?: string } | null)?.day === now.date) return "";
  await supabaseAdmin.from("app_settings").upsert({ key: "watch_report_day", value: { day: now.date }, updated_at: new Date().toISOString() });
  const n = await sendWatchReports(now.date);
  return n ? `${n} watch report(s) e-mailed` : "";
}

export async function sendWatchReports(day: string, onlyId?: string): Promise<number> {
  const { sendEmail } = await import("@/lib/notify");
  const { CCTV_BUCKET } = await import("@/lib/cctv");
  const people = (await listWatch()).filter((p) => p.active && (!onlyId || p.id === onlyId));
  const from = new Date(Date.parse(`${day}T00:00:00+05:30`)).toISOString();
  const to = new Date(Date.parse(`${day}T00:00:00+05:30`) + 86_400_000).toISOString();
  const dateText = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  let sent = 0;
  for (const p of people) {
    const { data } = await supabaseAdmin.from("watch_sightings").select("id, at, direction, photo_path").eq("watch_id", p.id).gte("at", from).lt("at", to).order("at");
    const rows = (data ?? []) as { id: number; at: string; direction: string; photo_path: string | null }[];
    const { moves, totalMs, openEnded } = inOut(rows);
    const lines = moves.map((mv) => `${mv.dir === "in" ? "IN " : "OUT"}  ${clock(mv.at)}`);
    const text = rows.length
      ? `${p.name} at ${p.store} on ${dateText}\n\nTime inside the store: ${dur(totalMs)}${openEnded ? " (no exit seen after the last entry)" : ""}\nFirst seen coming in: ${moves.find((x) => x.dir === "in") ? clock(moves.find((x) => x.dir === "in")!.at) : "—"}\nLast seen going out: ${[...moves].reverse().find((x) => x.dir === "out") ? clock([...moves].reverse().find((x) => x.dir === "out")!.at) : "—"}\n\nIn / out (entrance camera):\n${lines.join("\n")}\n\nThe photos are attached. Identified by the AI photo check from the entrance camera; please treat a single unexpected entry with care.\n\nSeven Years Care`
      : `${p.name} at ${p.store} on ${dateText}\n\nThe entrance camera did not recognise ${p.name} today (no in / out seen).\n\nSeven Years Care`;
    const attachments: { filename: string; contentType: string; content: Uint8Array }[] = [];
    for (const r of rows.slice(0, 30)) {
      if (!r.photo_path) continue;
      const { data: blob } = await supabaseAdmin.storage.from(CCTV_BUCKET).download(r.photo_path);
      if (blob) attachments.push({ filename: `${clock(r.at).replace(/[: ]/g, "")}-${r.direction}.jpg`, contentType: "image/jpeg", content: new Uint8Array(await blob.arrayBuffer()) });
    }
    for (const to of p.emails.split(/,\s*/).filter(Boolean)) {
      const r = await sendEmail(to, `${p.name}: in / out at ${p.store}, ${dateText}${rows.length ? ` — ${dur(totalMs)} inside` : ""}`, text, { audience: "staff" }, undefined, attachments);
      if (r.ok) sent++;
    }
    // Nothing is kept in the app once the report has gone.
    if (!onlyId) await supabaseAdmin.from("watch_sightings").delete().eq("watch_id", p.id).lt("at", to);
  }
  return sent;
}
