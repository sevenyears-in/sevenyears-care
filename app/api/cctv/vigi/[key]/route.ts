import { NextResponse } from "next/server";
import { linkByKey, logCctvRequest, requestNote, saveEvents } from "@/lib/cctv";

// TP-Link VIGI NVR → Alarm Server (Settings → Event → Alarm Server on the NVR).
// URL path: /api/cctv/vigi/<link key from Settings → Attendance → CCTV>.
// Body: JSON { device_id, device_name, messages: [...] }, or multipart/form-data with the JSON
// in "event" (or any text part) and a JPEG in "snapshot" (or any file part). The NVR expects 200 OK.
// Every call is noted (without the photo) so Settings can show what the recorder really sends.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

async function readBody(request: Request): Promise<{ body: unknown; photo: Blob | null; parts: string[]; text: string }> {
  const type = request.headers.get("content-type") ?? "";
  if (/multipart\/form-data/i.test(type)) {
    const form = await request.formData();
    const parts: string[] = [];
    let text = "";
    let photo: Blob | null = null;
    for (const [name, v] of form.entries()) {
      if (typeof v === "string") {
        parts.push(`${name} (text ${v.length})`);
        if (!text || name === "event") text = v;
      } else {
        parts.push(`${name} (${v.type || "file"} ${v.size} bytes)`);
        const isImage = /image|jpe?g/i.test(v.type) || /snapshot|image|pic|jpg/i.test(name);
        if (isImage && (!photo || name === "snapshot")) photo = v;
        else if (!isImage && (!text || name === "event")) text = await v.text();
      }
    }
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { unreadable: text.slice(0, 2000) };
    }
    return { body, photo, parts, text };
  }
  const text = await request.text();
  try {
    return { body: text ? JSON.parse(text) : {}, photo: null, parts: [], text };
  } catch {
    return { body: { unreadable: text.slice(0, 2000) }, photo: null, parts: [], text };
  }
}

async function receive(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const link = await linkByKey(key);
  const note = requestNote(request);
  if (!link) {
    await logCctvRequest({ ...note, store: null, key: key.slice(0, 6), error: "Unknown link" });
    return NextResponse.json({ error: "Unknown link." }, { status: 404 });
  }
  let parts: string[] = [];
  let sample = "";
  try {
    const r = await readBody(request);
    parts = r.parts;
    sample = r.text.slice(0, 600);
    const saved = await saveEvents(link, r.body, r.photo);
    await logCctvRequest({ ...note, store: link.store, parts, sample, saved, photo: Boolean(r.photo) });
    return NextResponse.json({ ok: true, saved });
  } catch (e) {
    const error = e instanceof Error ? e.message : typeof e === "object" ? JSON.stringify(e) : String(e);
    console.error("CCTV event not saved:", error);
    await logCctvRequest({ ...note, store: link.store, parts, sample, error: error.slice(0, 300) });
    // 200 anyway: the NVR would otherwise keep retrying the same event.
    return NextResponse.json({ ok: false });
  }
}

export const POST = receive;
export const PUT = receive;

/** The NVR's "Test" button (and a quick check in a browser). */
export async function GET(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const link = await linkByKey(key);
  await logCctvRequest({ ...requestNote(request), store: link?.store ?? null, key: key.slice(0, 6) });
  if (!link) return NextResponse.json({ error: "Unknown link." }, { status: 404 });
  return NextResponse.json({ ok: true, store: link.store });
}

export async function HEAD(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const link = await linkByKey(key);
  await logCctvRequest({ ...requestNote(request), store: link?.store ?? null, key: key.slice(0, 6) });
  return new Response(null, { status: 200 });
}

export async function OPTIONS(request: Request, ctx: Ctx) {
  const { key } = await ctx.params;
  const link = await linkByKey(key);
  await logCctvRequest({ ...requestNote(request), store: link?.store ?? null, key: key.slice(0, 6) });
  return new Response(null, { status: 204, headers: { Allow: "GET, HEAD, POST, PUT, OPTIONS" } });
}
