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
    "Store Managers wear a maroon shirt with the Seven Years logo; other staff wear a black T-shirt with the Seven Years logo. Anyone dressed like this is staff, not a customer.",
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

type Img = { b64: string; label?: string };

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
      body: JSON.stringify({ model: m, max_tokens: 400, messages: [{ role: "user", content }] }),
    });
    const d = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`AI (${m}): ${d.error?.message ?? res.status}`);
    text = (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  } else {
    const content: unknown[] = [];
    for (const im of images) {
      if (im.label) content.push({ type: "text", text: im.label });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${im.b64}` } });
    }
    content.push({ type: "text", text: prompt });
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: m, max_tokens: 400, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }),
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

const g = globalThis as unknown as { __syAiBusy?: boolean; __syAiError?: string; __syAiRefs?: { at: number; refs: Map<string, Img & { id: string }> } };

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

/** Ask the AI about one doorway photo. */
export async function checkDoorPhoto(photo: Blob, s: CameraAiSettings, refs: (Img & { id: string })[]): Promise<DoorCheck> {
  const prompt = `This is a CCTV snapshot from the camera inside the entrance of a Seven Years baby and kids store. It was taken when someone crossed a line drawn on the floor just inside the door.
Staff uniform: ${s.uniform}
${refs.length ? `Reference photos of people to look for were given above, each with its id. A person matches only if face, build and clothes clearly fit; if unsure, do not list them.` : ""}
Look at the people at or near the door / the line (ignore people far inside the store and anyone outside the glass).
Count ONLY real people who are walking through the doorway (coming in or going out). Do NOT count: mannequins, dummies or child-size display figures (they stand still and wear the store's clothes on show), toys, pictures or posters; people sitting, standing still or crouching / working on the floor; anyone already well inside the store. If nobody is walking through the door, answer 0 people.
Answer with JSON only:
{"people": <number of real people walking through the door>, "staff": <how many of them wear the staff uniform>, "customers": <people not in uniform>, "groups": <separate customer parties: people walking in together - a family, a couple, friends walking close - are ONE party; 0 if no customers>, "direction": "in" if they are walking into the store (towards the camera / away from the door), "out" if leaving (towards the door), "unclear" otherwise, "watched": [ids of the reference people who are in this photo]}`;
  const images: Img[] = [...refs, { b64: await toB64(photo), label: "CCTV snapshot to check:" }];
  const r = await visionJson(prompt, images, s.model);
  const num = (v: unknown) => Math.max(0, Math.min(50, Math.round(Number(v) || 0)));
  const dir = r.direction === "in" || r.direction === "out" ? r.direction : "unclear";
  const ids = new Set(refs.map((x) => x.id));
  return {
    people: num(r.people),
    staff: num(r.staff),
    customers: num(r.customers),
    groups: num(r.groups),
    direction: dir,
    watched: Array.isArray(r.watched) ? r.watched.map(String).filter((x) => ids.has(x)) : [],
  };
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
      .limit(8);
    const rows = (data ?? []) as { id: number; store: string; channel: number | null; event_at: string; photo_path: string }[];
    if (!rows.length) return "";
    const people = (await listWatch().catch(() => [])).filter((p) => p.active);
    const refs = await refPhotos(people);
    let done = 0;
    for (const r of rows) {
      const link = links.find((l) => l.store === r.store);
      if (!link || (link.channels.length && r.channel !== null && !link.channels.includes(r.channel))) {
        await supabaseAdmin.from("cctv_events").update({ ai_at: new Date().toISOString(), ai: { skipped: true } }).eq("id", r.id);
        continue;
      }
      const { data: blob } = await supabaseAdmin.storage.from(CCTV_BUCKET).download(r.photo_path);
      if (!blob) {
        await supabaseAdmin.from("cctv_events").update({ ai_at: new Date().toISOString(), ai: { error: "photo missing" } }).eq("id", r.id);
        continue;
      }
      const storeRefs = people.filter((p) => p.store === r.store).map((p) => refs.get(p.id)).filter((x): x is Img & { id: string } => Boolean(x));
      try {
        const res = await checkDoorPhoto(blob, s, storeRefs);
        await supabaseAdmin.from("cctv_events").update({ ai_at: new Date().toISOString(), ai: res }).eq("id", r.id);
        for (const id of res.watched) {
          await supabaseAdmin.from("watch_sightings").insert({ watch_id: id, event_id: r.id, store: r.store, at: r.event_at, direction: res.direction, photo_path: r.photo_path });
        }
        g.__syAiError = undefined;
        done++;
      } catch (e) {
        g.__syAiError = e instanceof Error ? e.message : String(e);
        break; // try again next minute (key missing, limit, network…)
      }
    }
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
