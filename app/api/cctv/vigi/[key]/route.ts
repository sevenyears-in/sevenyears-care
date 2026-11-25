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

/** Finds `needle` in `hay` from `from`; -1 if not there. */
function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * Multipart read from the raw bytes. The VIGI NVR sends the JPEG in a part without a file name,
 * which the standard form reader turns into (broken) text; reading the bytes keeps the photo intact.
 */
function readMultipart(buf: Uint8Array, boundary: string) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const delim = enc.encode(`--${boundary}`);
  const sep = enc.encode("\r\n\r\n");
  const out: { name: string; type: string; data: Uint8Array }[] = [];
  let pos = indexOf(buf, delim);
  while (pos >= 0) {
    const start = pos + delim.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing --boundary--
    const next = indexOf(buf, delim, start);
    const end = next >= 0 ? next : buf.length;
    const headEnd = indexOf(buf, sep, start);
    if (headEnd < 0 || headEnd > end) break;
    const head = dec.decode(buf.subarray(start, headEnd));
    let dataEnd = end;
    if (buf[dataEnd - 2] === 0x0d && buf[dataEnd - 1] === 0x0a) dataEnd -= 2; // CRLF before the next boundary
    const name = /name="?([^";\r\n]+)"?/i.exec(head)?.[1] ?? "";
    const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? "";
    out.push({ name, type, data: buf.slice(headEnd + sep.length, dataEnd) });
    pos = next;
  }
  return out;
}

async function readBody(request: Request): Promise<{ body: unknown; photo: Blob | null; parts: string[]; text: string }> {
  const type = request.headers.get("content-type") ?? "";
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/multipart\/form-data/i.test(type) && boundary) {
    const buf = new Uint8Array(await request.arrayBuffer());
    const parts: string[] = [];
    let text = "";
    let photo: Blob | null = null;
    for (const p of readMultipart(buf, boundary)) {
      let data = p.data;
      // A photo sent as base64 text.
      if (!isJpeg(data) && data.length > 1000 && /^[A-Za-z0-9+/=\s]+$/.test(new TextDecoder().decode(data.subarray(0, 200)))) {
        const b = Buffer.from(new TextDecoder().decode(data).replace(/\s+/g, ""), "base64");
        if (isJpeg(b)) data = new Uint8Array(b);
      }
      if (isJpeg(data) || /image/i.test(p.type)) {
        parts.push(`${p.name} (${p.type || "jpeg"} ${data.length} bytes)`);
        if (!photo || p.name === "snapshot") photo = new Blob([new Uint8Array(data)], { type: "image/jpeg" });
      } else {
        const v = new TextDecoder().decode(data);
        parts.push(`${p.name} (text ${v.length})`);
        if (!text || p.name === "event") text = v;
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
